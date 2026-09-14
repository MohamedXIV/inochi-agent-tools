import std.file : exists, getSize, remove;
import std.json : JSONType, parseJSON;
import std.stdio : stderr;
import std.string : fromStringz, toStringz;

extern(C) int iat_edit_visual_puppet_json(
    const(char)* inputPath,
    const(char)* outputPath,
    const(char)* operationsJson,
    char** outJson,
    char** outError,
);
extern(C) void iat_string_free(char* value);

int main(string[] args) {
    if (args.length != 3) {
        stderr.writeln("parameter-authoring-probe: expected input.inp output.inp");
        return 2;
    }

    if (exists(args[2])) remove(args[2]);
    auto operations = `[` ~
        `{"type":"node.create","parentPath":"/Root","name":"Rig"},` ~
        `{"type":"parameter.create","name":"Move X","dimensions":1,"min":[-1,0],"max":[1,0],"defaultValue":[0,0]},` ~
        `{"type":"parameter.bind","parameterName":"Move X","targetPath":"/Root/Rig","property":"transform.t.x","keypoints":[{"at":[-1,0],"value":-20},{"at":[1,0],"value":20}]}` ~
        `]`;

    char* json;
    char* error;
    auto result = iat_edit_visual_puppet_json(
        toStringz(args[1]),
        toStringz(args[2]),
        toStringz(operations),
        &json,
        &error,
    );
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
    }

    if (result != 0) {
        stderr.writeln(
            "parameter-authoring-probe: edit failed: ",
            error is null ? "<no diagnostic>" : fromStringz(error),
        );
        return 3;
    }
    if (json is null || error !is null || !exists(args[2]) || getSize(args[2]) == 0) {
        stderr.writeln("parameter-authoring-probe: invalid success/output contract");
        return 4;
    }

    auto decoded = parseJSON(fromStringz(json));
    if (decoded["parameters"].type != JSONType.array || decoded["parameters"].array.length != 1) {
        stderr.writeln("parameter-authoring-probe: expected one reopened parameter");
        return 5;
    }
    auto parameter = decoded["parameters"].array[0];
    if (parameter["name"].str != "Move X" || parameter["dimensions"].integer != 1 ||
        parameter["bindings"].type != JSONType.array || parameter["bindings"].array.length != 1) {
        stderr.writeln("parameter-authoring-probe: reopened parameter contract mismatch: ", parameter.toString());
        return 6;
    }
    auto binding = parameter["bindings"].array[0];
    if (binding["targetPath"].str != "/Root/Rig" || binding["property"].str != "transform.t.x" ||
        binding["keypoints"].type != JSONType.array || binding["keypoints"].array.length != 2) {
        stderr.writeln("parameter-authoring-probe: reopened binding contract mismatch: ", binding.toString());
        return 7;
    }

    return 0;
}
