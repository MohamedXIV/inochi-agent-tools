import std.file : exists, getSize;
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
    if (args.length != 4) {
        stderr.writeln("visual-authoring-probe: expected input.inp output.inp image.png");
        return 2;
    }

    auto operations = `[` ~
        `{"type":"texture.import","key":"face","imagePath":"` ~ args[3] ~ `"},` ~
        `{"type":"node.create","parentPath":"/Root","name":"Body"},` ~
        `{"type":"part.create","parentPath":"/Root/Body","name":"Face","textureKey":"face"}` ~
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

    auto decoded = parseJSON(fromStringz(json).idup);
    if (decoded["textures"].type != JSONType.array || decoded["textures"].array.length != 1) {
        stderr.writeln("visual-authoring-probe: expected one reopened texture");
        return 5;
    }
    auto textureRef = decoded["textures"].array[0]["ref"].str;

    bool foundFace;
    foreach (ref node; decoded["nodes"].array) {
        if (node["path"].str != "/Root/Body/Face") continue;
        foundFace = true;
        if (node["kind"].str != "part" || node["textures"].array.length != 1 ||
            node["textures"].array[0]["usage"].str != "albedo" ||
            node["textures"].array[0]["ref"].str != textureRef) {
            stderr.writeln("visual-authoring-probe: Face Part texture relationship mismatch");
            return 6;
        }
    }
    if (!foundFace) {
        stderr.writeln("visual-authoring-probe: missing /Root/Body/Face");
        return 7;
    }
    return 0;
}
