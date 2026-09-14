import std.stdio : stderr, stdout;
import std.string : fromStringz, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) int iat_create_minimal_puppet_json(
    const(char)* outputPath,
    const(char)* name,
    char** outJson,
    char** outError,
);
extern(C) int iat_edit_visual_puppet_json(
    const(char)* inputPath,
    const(char)* outputPath,
    const(char)* operationsJson,
    char** outJson,
    char** outError,
);
extern(C) int iat_evaluate_parameters_json(
    const(char)* inputPath,
    const(char)* valuesJson,
    char** outJson,
    char** outError,
);
extern(C) int iat_save_puppet(
    const(char)* inputPath,
    const(char)* outputPath,
    char** outError,
);
extern(C) void iat_string_free(char* value);

private int emitResult(int result, char* json, char* error, string fallback) {
    if (result != 0) {
        if (error !is null) {
            stderr.writeln(fromStringz(error));
            iat_string_free(error);
        } else {
            stderr.writeln(fallback);
        }
        if (json !is null) iat_string_free(json);
        return result;
    }

    if (json is null) {
        if (error !is null) iat_string_free(error);
        stderr.writeln(fallback ~ " returned no JSON");
        return 1;
    }

    stdout.write(fromStringz(json));
    iat_string_free(json);
    if (error !is null) iat_string_free(error);
    return 0;
}

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
    return emitResult(0, json, error, "native puppet inspection");
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
    return emitResult(result, json, error, "native minimal puppet creation failed");
}

private int runEditVisual(string inputPath, string outputPath, string operationsJson) {
    char* json;
    char* error;
    auto result = iat_edit_visual_puppet_json(
        toStringz(inputPath),
        toStringz(outputPath),
        toStringz(operationsJson),
        &json,
        &error,
    );
    return emitResult(result, json, error, "native visual puppet authoring failed");
}

private int runEvaluateParameters(string inputPath, string valuesJson) {
    char* json;
    char* error;
    auto result = iat_evaluate_parameters_json(
        toStringz(inputPath),
        toStringz(valuesJson),
        &json,
        &error,
    );
    return emitResult(result, json, error, "native parameter evaluation failed");
}

private int runSaveAs(string inputPath, string outputPath) {
    char* error;
    auto result = iat_save_puppet(
        toStringz(inputPath),
        toStringz(outputPath),
        &error,
    );
    if (result != 0) {
        if (error !is null) {
            stderr.writeln(fromStringz(error));
            iat_string_free(error);
        } else {
            stderr.writeln("native puppet save-as failed");
        }
        return result;
    }
    if (error !is null) iat_string_free(error);
    return runInspect(outputPath);
}

int main(string[] args) {
    if (args.length == 3 && args[1] == "inspect") {
        return runInspect(args[2]);
    }

    if (args.length == 4 && args[1] == "create-minimal") {
        return runCreateMinimal(args[2], args[3]);
    }

    if (args.length == 4 && args[1] == "save-as") {
        return runSaveAs(args[2], args[3]);
    }

    if (args.length == 5 && args[1] == "edit-visual") {
        return runEditVisual(args[2], args[3], args[4]);
    }

    if (args.length == 4 && args[1] == "evaluate-parameters") {
        return runEvaluateParameters(args[2], args[3]);
    }

    stderr.writeln(
        "usage: iat_native_host inspect <puppet-path> | " ~
        "create-minimal <output.inp> <name> | " ~
        "save-as <input.inp> <output.inp> | " ~
        "edit-visual <input.inp> <output.inp> <operations-json> | " ~
        "evaluate-parameters <input.inp> <values-json>",
    );
    return 2;
}
