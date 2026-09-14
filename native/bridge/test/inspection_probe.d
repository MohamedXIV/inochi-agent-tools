import std.json : parseJSON;
import std.stdio : stderr;
import std.string : fromStringz, indexOf, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 3) {
        stderr.writeln("inspection-probe: expected valid and invalid fixture paths");
        return 2;
    }

    char* json;
    char* error;
    auto validPath = toStringz(args[1]);
    auto result = iat_inspect_puppet_json(validPath, &json, &error);
    if (result != 0) {
        stderr.writeln("inspection-probe: inspect failed: ", error is null ? "<no diagnostic>" : fromStringz(error));
        if (error !is null) iat_string_free(error);
        return 3;
    }
    if (json is null || error !is null) {
        stderr.writeln("inspection-probe: invalid success ownership contract");
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
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
            iat_string_free(json);
            return 5;
        }
    }

    auto decoded = parseJSON(text.idup);
    if ("textures" !in decoded.object || !decoded["textures"].isArray || decoded["textures"].array.length != 0) {
        stderr.writeln("inspection-probe: native snapshot must expose empty top-level textures array");
        iat_string_free(json);
        return 7;
    }
    foreach (ref node; decoded["nodes"].array) {
        if ("textures" !in node.object || !node["textures"].isArray || node["textures"].array.length != 0) {
            stderr.writeln("inspection-probe: native node snapshot must expose textures array");
            iat_string_free(json);
            return 8;
        }
    }

    iat_string_free(json);
    json = null;

    auto invalidPath = toStringz(args[2]);
    result = iat_inspect_puppet_json(invalidPath, &json, &error);
    if (result == 0 || json !is null || error is null || fromStringz(error).length == 0) {
        stderr.writeln("inspection-probe: malformed puppet did not fail closed");
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
        return 6;
    }
    iat_string_free(error);
    return 0;
}
