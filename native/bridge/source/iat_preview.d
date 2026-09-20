module iat_preview;

import core.stdc.stdlib : malloc;
import core.stdc.string : memcpy;
import inochi2d.core.format.inp : inLoadPuppet;
import inochi2d.core.mesh : VtxData;
import inochi2d.core.puppet : Puppet;
import inochi2d.core.render.drawlist : DrawState;
import std.json : JSONValue, toJSON;
import std.math : isFinite;
import std.string : fromStringz;

private char* copyCString(string value) nothrow {
    auto memory = cast(char*) malloc(value.length + 1);
    if (memory is null) return null;
    if (value.length > 0) memcpy(memory, value.ptr, value.length);
    memory[value.length] = '\0';
    return memory;
}

private int fail(char** outError, int code, string message) nothrow {
    if (outError !is null) *outError = copyCString(message);
    return code;
}

private string stateName(DrawState state) {
    final switch (state) with (DrawState) {
        case normal: return "normal";
        case defineMask: return "defineMask";
        case maskedDraw: return "maskedDraw";
        case compositeBegin: return "compositeBegin";
        case compositeEnd: return "compositeEnd";
        case compositeBlit: return "compositeBlit";
    }
}

/**
 * Capture the renderer-agnostic frame produced by pinned Inochi2D.
 *
 * This deliberately exposes semantic frame metadata only. Native draw-list
 * handles, allocation ids, raw pointers and implementation enums stay inside
 * the bridge. The headless renderer can consume the same DrawList internally
 * without expanding the public agent-facing contract.
 */
export extern(C) int iat_capture_preview_frame_json(
    const(char)* inputPath,
    char** outJson,
    char** outError,
) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null;
    *outError = null;
    if (inputPath is null) return fail(outError, 2, "input path is required");

    try {
        auto path = fromStringz(inputPath).idup;
        auto puppet = inLoadPuppet!Puppet(path);
        if (puppet is null) return fail(outError, 3, "failed loading puppet for preview capture");
        scope(exit) destroy(puppet);

        // A preview is a deterministic zero-delta render pass. Parameter values
        // are applied by the semantic layer before this boundary.
        puppet.update(0.0f);
        puppet.draw(0.0f);

        auto drawList = puppet.drawList;
        auto commands = drawList.commands;
        auto vertices = drawList.vertices;
        auto indices = drawList.indices;

        ulong drawableCommands;
        ulong texturedCommands;
        ulong normalCommands;
        ulong maskDefinitionCommands;
        ulong maskedCommands;
        ulong compositeCommands;

        foreach (ref command; commands) {
            if (command.elemCount > 0) drawableCommands++;
            if (command.sources[0] !is null) texturedCommands++;
            final switch (command.state) with (DrawState) {
                case normal: normalCommands++; break;
                case defineMask: maskDefinitionCommands++; break;
                case maskedDraw: maskedCommands++; break;
                case compositeBegin:
                case compositeEnd:
                case compositeBlit:
                    compositeCommands++;
                    break;
            }
        }

        bool hasBounds = vertices.length > 0;
        float minX, minY, maxX, maxY;
        if (hasBounds) {
            minX = maxX = vertices[0].vtx.x;
            minY = maxY = vertices[0].vtx.y;
            foreach (ref vertex; vertices[1 .. $]) {
                if (vertex.vtx.x < minX) minX = vertex.vtx.x;
                if (vertex.vtx.x > maxX) maxX = vertex.vtx.x;
                if (vertex.vtx.y < minY) minY = vertex.vtx.y;
                if (vertex.vtx.y > maxY) maxY = vertex.vtx.y;
            }
            hasBounds = isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY);
        }

        JSONValue result = JSONValue.emptyObject;
        result["schemaVersion"] = 1;
        result["kind"] = "inochi2d-draw-list-frame";
        result["commandCount"] = cast(ulong) commands.length;
        result["drawableCommandCount"] = drawableCommands;
        result["texturedCommandCount"] = texturedCommands;
        result["vertexCount"] = cast(ulong) vertices.length;
        result["indexCount"] = cast(ulong) indices.length;
        result["states"] = JSONValue.emptyObject;
        result["states"]["normal"] = normalCommands;
        result["states"]["defineMask"] = maskDefinitionCommands;
        result["states"]["maskedDraw"] = maskedCommands;
        result["states"]["composite"] = compositeCommands;
        result["hasRenderableContent"] = drawableCommands > 0 && vertices.length >= 3 && indices.length >= 3;

        if (hasBounds) {
            result["bounds"] = JSONValue.emptyObject;
            result["bounds"]["minX"] = minX;
            result["bounds"]["minY"] = minY;
            result["bounds"]["maxX"] = maxX;
            result["bounds"]["maxY"] = maxY;
        } else {
            result["bounds"] = null;
        }

        *outJson = copyCString(result.toJSON());
        if (*outJson is null) return fail(outError, 1, "failed allocating preview frame JSON");
        return 0;
    } catch (Throwable error) {
        return fail(outError, 1, "preview frame capture failed: " ~ error.msg);
    }
}
