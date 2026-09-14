module iat_bridge;

import core.stdc.stdlib : free, malloc;
import core.stdc.string : memcpy;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.puppet : Puppet;
import inochi2d.ver : IN_VERSION;
import nulib.threading.internal.semaphore : NativeSemaphore;
import nulib.threading.internal.thread : NativeThread, ThreadContext;
import std.file : exists, getSize, mkdirRecurse;
import std.json : JSONValue, toJSON;
import std.path : dirName, extension;
import std.string : fromStringz, strip;
import std.uni : toLower;

private enum upstreamVersion = IN_VERSION ~ "\0";

// NuLib 0.3.8's Linux/LDC POSIX package documents that LDC can discard
// threading TypeInfo when static archives are consumed by a shared library.
// Keep explicit bridge-owned references so the archive members defining these
// runtime metadata symbols are pulled into libiat_bridge instead of surfacing
// as unresolved symbols when an external process loads the bridge.
private __gshared TypeInfo nulibThreadContextTypeInfo = typeid(ThreadContext);
private __gshared ClassInfo nulibNativeThreadClassInfo = NativeThread.classinfo;
private __gshared ClassInfo nulibNativeSemaphoreClassInfo = NativeSemaphore.classinfo;

private char* copyCString(string value) nothrow {
    auto memory = cast(char*) malloc(value.length + 1);
    if (memory is null) return null;
    if (value.length > 0) memcpy(memory, value.ptr, value.length);
    memory[value.length] = '\0';
    return memory;
}

private void appendNodeSnapshot(Node node, ref JSONValue nodes, ref size_t nodeCount, ref size_t partCount) {
    if (node is null) return;

    JSONValue item = JSONValue.emptyObject;
    item["path"] = node.getNodePath();
    item["name"] = node.name.value;
    item["kind"] = cast(Part) node ? "part" : "node";
    item["childCount"] = cast(ulong) node.children.length;
    nodes.array ~= item;
    nodeCount++;
    if (cast(Part) node) partCount++;

    foreach (child; node.children) {
        appendNodeSnapshot(child, nodes, nodeCount, partCount);
    }
}

private string buildInspectionJson(Puppet puppet) {
    JSONValue result = JSONValue.emptyObject;
    result["schemaVersion"] = 1;

    JSONValue metadata = JSONValue.emptyObject;
    metadata["name"] = puppet.meta.name.value;
    metadata["inochiVersion"] = puppet.meta.version_.value;
    metadata["rigger"] = puppet.meta.rigger.value;
    metadata["artist"] = puppet.meta.artist.value;
    result["metadata"] = metadata;

    JSONValue nodes = JSONValue.emptyArray;
    size_t nodeCount;
    size_t partCount;
    appendNodeSnapshot(puppet.root, nodes, nodeCount, partCount);
    result["nodes"] = nodes;

    JSONValue parameters = JSONValue.emptyArray;
    foreach (parameter; puppet.parameters) {
        JSONValue item = JSONValue.emptyObject;
        item["name"] = parameter.name.value;
        item["dimensions"] = parameter.isVec2 ? 2 : 1;
        item["min"] = JSONValue([parameter.min.x, parameter.min.y]);
        item["max"] = JSONValue([parameter.max.x, parameter.max.y]);
        item["defaultValue"] = JSONValue([parameter.defaults.x, parameter.defaults.y]);
        item["value"] = JSONValue([parameter.value.x, parameter.value.y]);
        parameters.array ~= item;
    }
    result["parameters"] = parameters;

    auto textureCount = puppet.textureCache is null ? 0UL : cast(ulong) puppet.textureCache.size;
    result["textureCount"] = textureCount;

    JSONValue summary = JSONValue.emptyObject;
    summary["nodeCount"] = cast(ulong) nodeCount;
    summary["partCount"] = cast(ulong) partCount;
    summary["parameterCount"] = cast(ulong) puppet.parameters.length;
    summary["textureCount"] = textureCount;
    result["summary"] = summary;

    return result.toJSON();
}

private int returnInspectionJson(Puppet puppet, char** outJson, char** outError) {
    auto json = buildInspectionJson(puppet);
    *outJson = copyCString(json);
    if (*outJson is null) {
        *outError = copyCString("failed allocating inspection result");
        return 1;
    }
    return 0;
}

export extern(C) nothrow @nogc uint iat_bridge_abi_version() {
    return 1;
}

export extern(C) nothrow @nogc const(char)* iat_bridge_upstream_version() {
    return upstreamVersion.ptr;
}

export extern(C) void iat_string_free(char* value) nothrow {
    if (value !is null) free(value);
}

export extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null;
    *outError = null;

    if (path is null) {
        *outError = copyCString("puppet path is null");
        return 2;
    }

    try {
        auto puppetPath = fromStringz(path).idup;
        auto puppet = inLoadPuppet!Puppet(puppetPath);
        scope(exit) destroy(puppet);
        return returnInspectionJson(puppet, outJson, outError);
    } catch (Throwable error) {
        *outError = copyCString(error.msg.idup);
        return 1;
    }
}

export extern(C) int iat_create_minimal_puppet_json(
    const(char)* outputPath,
    const(char)* name,
    char** outJson,
    char** outError,
) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null;
    *outError = null;

    if (outputPath is null || name is null) {
        *outError = copyCString("output path and puppet name are required");
        return 2;
    }

    try {
        auto output = fromStringz(outputPath).idup;
        auto nameText = fromStringz(name).idup;

        if (nameText.strip.length == 0 || toLower(extension(output)) != ".inp") {
            *outError = copyCString("invalid minimal puppet authoring request");
            return 4;
        }

        if (exists(output)) {
            *outError = copyCString("puppet output already exists");
            return 5;
        }

        auto parent = dirName(output);
        if (parent.length > 0) mkdirRecurse(parent);

        auto puppet = new Puppet();
        scope(exit) destroy(puppet);
        puppet.meta.name = nameText;
        inWriteINPPuppet(puppet, output);

        if (!exists(output) || getSize(output) == 0) {
            *outError = copyCString("official writer produced no puppet artifact");
            return 1;
        }

        auto reopened = inLoadPuppet!Puppet(output);
        scope(exit) destroy(reopened);
        if (reopened is null || reopened.meta.name.value != nameText) {
            *outError = copyCString("saved puppet did not preserve requested metadata");
            return 6;
        }

        return returnInspectionJson(reopened, outJson, outError);
    } catch (Throwable error) {
        *outError = copyCString(error.msg.idup);
        return 1;
    }
}
