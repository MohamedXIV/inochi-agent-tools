import std.stdio : stderr;
import std.string : toStringz;

extern(C) int iat_evaluate_parameters_json(
    const(char)* inputPath,
    const(char)* valuesJson,
    char** outJson,
    char** outError,
);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("parameter-evaluation-probe: expected input.inp");
        return 2;
    }

    char* json;
    char* error;
    auto result = iat_evaluate_parameters_json(
        toStringz(args[1]),
        toStringz(`{"Move X":[1,0],"Move Y":[-1,0]}`),
        &json,
        &error,
    );
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
    }

    if (result != 0) {
        stderr.writeln("parameter-evaluation-probe: evaluation failed");
        return 3;
    }
    if (json is null || error !is null) {
        stderr.writeln("parameter-evaluation-probe: invalid success contract");
        return 4;
    }
    return 0;
}
