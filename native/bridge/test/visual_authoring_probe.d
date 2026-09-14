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

private bool expectFailure(string input, string output, string operations, int expectedCode) {
    if (exists(output)) remove(output);
    char* json;
    char* error;
    auto result = iat_edit_visual_puppet_json(
        toStringz(input),
        toStringz(output),
        toStringz(operations),
        &json,
        &error,
    );
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
        if (exists(output)) remove(output);
    }
    if (result != expectedCode) {
        stderr.writeln(
            "visual-authoring-probe: expected failure code ", expectedCode,
            " but got ", result, ": ", error is null ? "<no diagnostic>" : fromStringz(error),
        );
        return false;
    }
    if (json !is null || error is null || exists(output)) {
        stderr.writeln("visual-authoring-probe: invalid failure/output contract for code ", expectedCode);
        return false;
    }
    return true;
}

int main(string[] args) {
    if (args.length != 4) {
        stderr.writeln("visual-authoring-probe: expected input.inp output.inp image.png");
        return 2;
    }

    auto operations = `[` ~
        `{"type":"texture.import","key":"face","imagePath":"` ~ args[3] ~ `"},` ~
        `{"type":"node.create","parentPath":"/Root","name":"Body"},` ~
        `{"type":"node.create","parentPath":"/Root","name":"Accessories"},` ~
        `{"type":"part.create","parentPath":"/Root/Body","name":"Face","textureKey":"face"},` ~
        `{"type":"node.reparent","path":"/Root/Body/Face","newParentPath":"/Root/Accessories"},` ~
        `{"type":"part.setTexture","path":"/Root/Accessories/Face","textureKey":"face"},` ~
        `{"type":"node.remove","path":"/Root/Body"}` ~
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
    if (result != 0) {
        stderr.writeln("visual-authoring-probe: edit failed: ", error is null ? "<no diagnostic>" : fromStringz(error));
        if (error !is null) iat_string_free(error);
        return 3;
    }
    scope(exit) if (json !is null) iat_string_free(json);

    if (json is null || error !is null || !exists(args[2]) || getSize(args[2]) == 0) {
        stderr.writeln("visual-authoring-probe: invalid success/output contract");
        if (error !is null) iat_string_free(error);
        return 4;
    }

    auto jsonText = fromStringz(json).idup;
    auto decoded = parseJSON(jsonText);
    if (decoded["textures"].type != JSONType.array || decoded["textures"].array.length != 1) {
        stderr.writeln("visual-authoring-probe: expected one reopened texture: ", jsonText);
        return 5;
    }
    auto textureRef = decoded["textures"].array[0]["ref"].str;

    bool foundFace;
    foreach (ref node; decoded["nodes"].array) {
        auto path = node["path"].str;
        if (path == "/Root/Body") {
            stderr.writeln("visual-authoring-probe: removed Body still present: ", jsonText);
            return 8;
        }
        if (path != "/Root/Accessories/Face") continue;
        foundFace = true;
        if (node["kind"].str != "part" || node["textures"].array.length != 1 ||
            node["textures"].array[0]["usage"].str != "albedo" ||
            node["textures"].array[0]["ref"].str != textureRef) {
            stderr.writeln("visual-authoring-probe: Face Part texture relationship mismatch: ", node.toString(), " inventoryRef=", textureRef);
            return 6;
        }
    }
    if (!foundFace) {
        stderr.writeln("visual-authoring-probe: missing /Root/Accessories/Face: ", jsonText);
        return 7;
    }

    auto textureImport = `{"type":"texture.import","key":"face","imagePath":"` ~ args[3] ~ `"}`;
    if (!expectFailure(
            args[1], args[2] ~ ".missing-parent.inp",
            `[{"type":"node.create","parentPath":"/Root/Missing","name":"Body"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".root-remove.inp",
            `[{"type":"node.remove","path":"/Root"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".root-reparent.inp",
            `[{"type":"node.create","parentPath":"/Root","name":"Body"},{"type":"node.reparent","path":"/Root","newParentPath":"/Root/Body"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".cycle.inp",
            `[{"type":"node.create","parentPath":"/Root","name":"Body"},{"type":"node.create","parentPath":"/Root/Body","name":"Child"},{"type":"node.reparent","path":"/Root/Body","newParentPath":"/Root/Body/Child"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".duplicate.inp",
            `[{"type":"node.create","parentPath":"/Root","name":"Body"},{"type":"node.create","parentPath":"/Root","name":"Body"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".non-part.inp",
            `[` ~ textureImport ~ `,{"type":"node.create","parentPath":"/Root","name":"Body"},{"type":"part.setTexture","path":"/Root/Body","textureKey":"face"}]`, 7) ||
        !expectFailure(
            args[1], args[2] ~ ".missing-texture.inp",
            `[{"type":"node.create","parentPath":"/Root","name":"Body"},{"type":"part.create","parentPath":"/Root/Body","name":"Face","textureKey":"missing"}]`, 8) ||
        !expectFailure(
            args[1], args[2] ~ ".bad-texture.inp",
            `[{"type":"texture.import","key":"face","imagePath":"missing-asset.png"}]`, 9)) {
        return 9;
    }

    return 0;
}
