import std.file : exists, getSize;
import std.json : parseJSON;
import std.stdio : stderr;
import std.string : fromStringz, toStringz;

extern(C) int iat_create_minimal_puppet_json(
    const(char)* outputPath,
    const(char)* name,
    char** outJson,
    char** outError,
);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("create-probe: expected output .inp path");
        return 2;
    }

    char* json;
    char* error;
    auto result = iat_create_minimal_puppet_json(
        args[1].toStringz,
        "M1 Created Puppet".toStringz,
        &json,
        &error,
    );
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
    }

    if (result != 0 || json is null || error !is null) {
        stderr.writeln("create-probe: create failed with code ", result);
        return 3;
    }

    auto decoded = parseJSON(fromStringz(json).idup);
    if (decoded["schemaVersion"].get!long != 1 || decoded["metadata"]["name"].str != "M1 Created Puppet") {
        stderr.writeln("create-probe: semantic round-trip snapshot mismatch");
        return 4;
    }

    if (!exists(args[1]) || getSize(args[1]) == 0) {
        stderr.writeln("create-probe: writer produced no real .inp artifact");
        return 5;
    }

    return 0;
}
