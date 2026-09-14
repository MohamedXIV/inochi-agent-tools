import std.stdio : stderr, stdout;
import std.string : fromStringz, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 3 || args[1] != "inspect") {
        stderr.writeln("usage: iat_native_host inspect <puppet-path>");
        return 2;
    }

    char* json;
    char* error;
    auto path = toStringz(args[2]);
    auto result = iat_inspect_puppet_json(path, &json, &error);

    if (result != 0) {
        if (error !is null) {
            stderr.writeln(fromStringz(error));
            iat_string_free(error);
        } else {
            stderr.writeln("native puppet inspection failed");
        }
        if (json !is null) iat_string_free(json);
        return 3;
    }

    if (json is null) {
        if (error !is null) iat_string_free(error);
        stderr.writeln("native puppet inspection returned no JSON");
        return 3;
    }

    stdout.write(fromStringz(json));
    iat_string_free(json);
    if (error !is null) iat_string_free(error);
    return 0;
}
