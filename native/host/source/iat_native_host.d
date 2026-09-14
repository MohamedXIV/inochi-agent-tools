import std.stdio : stderr, stdout;
import std.string : fromStringz, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) int iat_create_minimal_puppet_json(
    const(char)* outputPath,
    const(char)* name,
    char** outJson,
    char** outError,
);
extern(C) void iat_string_free(char* value);

private int runInspect(string path) {
    char* json;
    char* error;
    auto result = iat_inspect_puppet_json(toStringz(path), &json, &error);

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

private int runCreateMinimal(string outputPath, string name) {
    char* json;
    char* error;
    auto result = iat_create_minimal_puppet_json(
        toStringz(outputPath),
        toStringz(name),
        &json,
        &error,
    );

    if (result != 0) {
        if (error !is null) {
            stderr.writeln(fromStringz(error));
            iat_string_free(error);
        } else {
            stderr.writeln("native minimal puppet creation failed");
        }
        if (json !is null) iat_string_free(json);
        return result;
    }

    if (json is null) {
        if (error !is null) iat_string_free(error);
        stderr.writeln("native minimal puppet creation returned no JSON");
        return 1;
    }

    stdout.write(fromStringz(json));
    iat_string_free(json);
    if (error !is null) iat_string_free(error);
    return 0;
}

int main(string[] args) {
    if (args.length == 3 && args[1] == "inspect") {
        return runInspect(args[2]);
    }

    if (args.length == 4 && args[1] == "create-minimal") {
        return runCreateMinimal(args[2], args[3]);
    }

    stderr.writeln("usage: iat_native_host inspect <puppet-path> | create-minimal <output.inp> <name>");
    return 2;
}
