import std.stdio : stderr;
import std.string : fromStringz, indexOf, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("inspection-probe: expected fixture path");
        return 2;
    }

    char* json;
    char* error;
    auto path = toStringz(args[1]);
    auto result = iat_inspect_puppet_json(path, &json, &error);
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
    }

    if (result != 0) {
        stderr.writeln("inspection-probe: inspect failed: ", error is null ? "<no diagnostic>" : fromStringz(error));
        return 3;
    }
    if (json is null) {
        stderr.writeln("inspection-probe: success returned null JSON");
        return 4;
    }

    auto text = fromStringz(json);
    foreach (needle; [
        `"schemaVersion":1`,
        "M1 Inspection Fixture",
        "Face",
        "Mouth",
        "Head X",
    ]) {
        if (text.indexOf(needle) < 0) {
            stderr.writeln("inspection-probe: missing semantic field: ", needle);
            return 5;
        }
    }

    return 0;
}
