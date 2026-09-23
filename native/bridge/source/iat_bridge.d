module iat_bridge;

import core.stdc.stdlib : free, malloc;
import core.stdc.string : memcpy;
import inmath : vec2, vec2u;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inochi2d.core.mesh : Mesh, MeshData, toMeshData;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.deformer.meshdeformer : MeshDeformer;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.nodes.drivers.simplephysics : SimplePhysics, PhysicsModel, ParamMapMode;
import inochi2d.core.param : Parameter, ValueParameterBinding;
import inochi2d.core.puppet : Puppet;
import inochi2d.core.render.texture : Texture, TextureData, TextureFormat;
import inochi2d.ver : IN_VERSION;
import nulib.threading.internal.semaphore : NativeSemaphore;
import nulib.threading.internal.thread : NativeThread, ThreadContext;
import numem.core.memory : nu_dup;
import std.digest.sha : sha256Of;
import std.file : exists, getSize, mkdirRecurse, read, remove;
import std.json : JSONType, JSONValue, parseJSON, toJSON;
import std.math : abs, isFinite;
import std.path : dirName, extension;
import std.string : fromStringz, split, strip;
import std.uni : toLower;

private enum upstreamVersion = IN_VERSION ~ "\0";

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

private int fail(char** outError, int code, string message) nothrow {
    if (outError !is null) *outError = copyCString(message);
    return code;
}

private void safeRemove(string path) nothrow {
    try {
        if (path.length > 0 && exists(path)) remove(path);
    } catch (Throwable) {
    }
}

private string lowerHex(const(ubyte)[] bytes) {
    enum digits = "0123456789abcdef";
    auto output = new char[](bytes.length * 2);
    foreach (i, value; bytes) {
        output[(i * 2)] = digits[(value >> 4) & 0x0f];
        output[(i * 2) + 1] = digits[value & 0x0f];
    }
    return cast(string) output;
}

private void writeUint32LE(ref ubyte[9] header, size_t offset, uint value) {
    header[offset] = cast(ubyte)(value & 0xff);
    header[offset + 1] = cast(ubyte)((value >> 8) & 0xff);
    header[offset + 2] = cast(ubyte)((value >> 16) & 0xff);
    header[offset + 3] = cast(ubyte)((value >> 24) & 0xff);
}

private string textureFingerprint(Texture texture) {
    if (texture is null) return "";
    ubyte[9] header;
    header[0] = cast(ubyte) texture.format;
    writeUint32LE(header, 1, texture.width);
    writeUint32LE(header, 5, texture.height);
    ubyte[] payload;
    payload ~= header[];
    payload ~= cast(ubyte[]) texture.pixels;
    auto digest = sha256Of(payload);
    return "sha256:" ~ lowerHex(digest[]);
}

private string textureFormatName(Texture texture) {
    if (texture is null) return "unknown";
    final switch (texture.format) {
        case TextureFormat.rgba8Unorm: return "rgba8";
        case TextureFormat.r8: return "r8";
        case TextureFormat.none:
        case TextureFormat.depthStencil: return "unknown";
    }
}

private string childPath(string parentPath, string name) {
    return parentPath ~ "/" ~ name;
}

private string semanticNodePath(Node node) {
    if (node is null || node.puppet is null || node.puppet.root is null) return "";
    auto root = node.puppet.root;
    string path;
    Node current = node;
    while (current !is null) {
        path = "/" ~ current.name.value ~ path;
        if (current is root) return path;
        current = current.parent;
    }
    return "";
}

private bool tryMeshSnapshot(Mesh source, out JSONValue result) {
    result = JSONValue.emptyObject;
    if (source is null) return false;

    auto mesh = source.toMeshData();
    if (mesh.vertices.length < 3 ||
        mesh.vertices.length != mesh.uvs.length ||
        mesh.indices.length < 3 ||
        mesh.indices.length % 3 != 0) return false;
    foreach (index; mesh.indices) if (index >= mesh.vertices.length) return false;

    JSONValue vertices = JSONValue.emptyArray;
    JSONValue uvs = JSONValue.emptyArray;
    JSONValue indices = JSONValue.emptyArray;
    foreach (vertex; mesh.vertices) vertices.array ~= JSONValue([vertex.x, vertex.y]);
    foreach (uv; mesh.uvs) uvs.array ~= JSONValue([uv.x, uv.y]);
    foreach (index; mesh.indices) indices.array ~= JSONValue(cast(ulong) index);

    result["vertices"] = vertices;
    result["uvs"] = uvs;
    result["indices"] = indices;
    return true;
}

private void appendNodeSnapshot(Node node, string path, ref JSONValue nodes, ref size_t nodeCount, ref size_t partCount) {
    if (node is null) return;
    JSONValue item = JSONValue.emptyObject;
    item["path"] = path;
    item["name"] = node.name.value;
    item["kind"] = cast(Part) node ? "part" : (cast(MeshDeformer) node ? "mesh-deformer" : (cast(SimplePhysics) node ? "simple-physics" : "node"));
    item["childCount"] = cast(ulong) node.children.length;
    JSONValue textureBindings = JSONValue.emptyArray;
    if (auto physics = cast(SimplePhysics) node) {
        JSONValue physicsInfo = JSONValue.emptyObject;
        final switch (physics.modelType) {
            case PhysicsModel.Pendulum: physicsInfo["model"] = "pendulum"; break;
            case PhysicsModel.SpringPendulum: physicsInfo["model"] = "spring-pendulum"; break;
        }
        final switch (physics.mapMode) {
            case ParamMapMode.AngleLength: physicsInfo["mapMode"] = "angle-length"; break;
            case ParamMapMode.XY: physicsInfo["mapMode"] = "xy"; break;
            case ParamMapMode.LengthAngle: physicsInfo["mapMode"] = "length-angle"; break;
            case ParamMapMode.YX: physicsInfo["mapMode"] = "yx"; break;
        }
        physicsInfo["parameterName"] = physics.param is null ? "" : physics.param.name.value;
        physicsInfo["gravity"] = physics.gravity;
        physicsInfo["length"] = physics.length;
        physicsInfo["frequency"] = physics.frequency;
        physicsInfo["angleDamping"] = physics.angleDamping;
        physicsInfo["lengthDamping"] = physics.lengthDamping;
        physicsInfo["outputScale"] = JSONValue([physics.outputScale.x, physics.outputScale.y]);
        physicsInfo["localOnly"] = physics.localOnly;
        item["physics"] = physicsInfo;
    }
    if (auto part = cast(Part) node) {
        static immutable usageNames = ["albedo", "emissive", "bumpmap"];
        foreach (i, usageName; usageNames) {
            auto texture = part.textures[i];
            if (texture is null) continue;
            JSONValue binding = JSONValue.emptyObject;
            binding["usage"] = usageName;
            binding["ref"] = textureFingerprint(texture);
            textureBindings.array ~= binding;
        }
        JSONValue mesh;
        if (tryMeshSnapshot(part.mesh, mesh)) item["mesh"] = mesh;
    } else if (auto deformer = cast(MeshDeformer) node) {
        JSONValue mesh;
        if (tryMeshSnapshot(deformer.mesh, mesh)) item["mesh"] = mesh;
    }
    item["textures"] = textureBindings;
    nodes.array ~= item;
    nodeCount++;
    if (cast(Part) node) partCount++;
    foreach (child; node.children) appendNodeSnapshot(child, childPath(path, child.name.value), nodes, nodeCount, partCount);
}

private JSONValue parameterBindingSnapshots(Parameter parameter) {
    JSONValue bindings = JSONValue.emptyArray;
    foreach (binding; parameter.bindings) {
        auto valueBinding = cast(ValueParameterBinding) binding;
        auto target = binding.getNode();
        if (valueBinding is null || target is null) continue;
        auto targetPath = semanticNodePath(target);
        if (targetPath.length == 0) continue;
        JSONValue item = JSONValue.emptyObject;
        item["targetPath"] = targetPath;
        item["property"] = binding.getName();
        JSONValue keypoints = JSONValue.emptyArray;
        foreach (x; 0 .. parameter.axisPointCount(0)) {
            foreach (y; 0 .. parameter.axisPointCount(1)) {
                auto index = vec2u(cast(uint) x, cast(uint) y);
                if (!binding.isSet(index)) continue;
                auto parameterValue = parameter.getKeypointValue(index);
                JSONValue keypoint = JSONValue.emptyObject;
                keypoint["index"] = JSONValue([cast(ulong) x, cast(ulong) y]);
                keypoint["parameterValue"] = JSONValue([parameterValue.x, parameterValue.y]);
                keypoint["value"] = valueBinding.getValue(index);
                keypoints.array ~= keypoint;
            }
        }
        item["keypoints"] = keypoints;
        bindings.array ~= item;
    }
    return bindings;
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
    auto rootPath = "/" ~ puppet.root.name.value;
    appendNodeSnapshot(puppet.root, rootPath, nodes, nodeCount, partCount);
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
        item["bindings"] = parameterBindingSnapshots(parameter);
        parameters.array ~= item;
    }
    result["parameters"] = parameters;
    JSONValue textures = JSONValue.emptyArray;
    if (puppet.textureCache !is null) {
        foreach (texture; puppet.textureCache.cache) {
            if (texture is null) continue;
            JSONValue item = JSONValue.emptyObject;
            item["ref"] = textureFingerprint(texture);
            item["width"] = texture.width;
            item["height"] = texture.height;
            item["format"] = textureFormatName(texture);
            textures.array ~= item;
        }
    }
    result["textures"] = textures;
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

private Node resolveNodePath(Puppet puppet, string path) {
    if (puppet is null || puppet.root is null || path.length == 0 || path[0] != '/') return null;
    auto segments = path.split("/");
    if (segments.length < 2 || segments[1] != puppet.root.name.value) return null;
    Node current = puppet.root;
    foreach (segment; segments[2 .. $]) {
        if (segment.length == 0) return null;
        Node found;
        size_t matches;
        foreach (child; current.children) {
            if (child.name.value == segment) { found = child; matches++; }
        }
        if (matches != 1) return null;
        current = found;
    }
    return current;
}

private bool hasSiblingNamed(Node parent, string name, Node except = null) {
    if (parent is null) return false;
    foreach (child; parent.children) if (child !is except && child.name.value == name) return true;
    return false;
}

private bool wouldCreateCycle(Node node, Node newParent) {
    Node current = newParent;
    while (current !is null) {
        if (current is node) return true;
        current = current.parent;
    }
    return false;
}

private void collectPartTextureExpectations(Node node, string path, ref string[string] expectedPartTextureByPath) {
    if (node is null) return;
    if (auto part = cast(Part) node) if (part.textures[0] !is null) expectedPartTextureByPath[path] = textureFingerprint(part.textures[0]);
    foreach (child; node.children) collectPartTextureExpectations(child, childPath(path, child.name.value), expectedPartTextureByPath);
}

private string requireJsonString(ref JSONValue object, string key) {
    if (object.type != JSONType.object || key !in object.object || object[key].type != JSONType.string) throw new Exception("missing or invalid string field: " ~ key);
    return object[key].str;
}

private bool requireJsonBool(ref JSONValue object, string key) {
    if (object.type != JSONType.object || key !in object.object) throw new Exception("missing boolean field: " ~ key);
    auto value = object[key];
    if (value.type == JSONType.true_) return true;
    if (value.type == JSONType.false_) return false;
    throw new Exception("invalid boolean field: " ~ key);
}

private PhysicsModel requirePhysicsModel(ref JSONValue object, string key) {
    auto value = requireJsonString(object, key);
    if (value == "pendulum") return PhysicsModel.Pendulum;
    if (value == "spring_pendulum") return PhysicsModel.SpringPendulum;
    throw new Exception("unsupported physics model");
}

private ParamMapMode requirePhysicsMapMode(ref JSONValue object, string key) {
    auto value = requireJsonString(object, key);
    if (value == "angle_length") return ParamMapMode.AngleLength;
    if (value == "xy") return ParamMapMode.XY;
    if (value == "length_angle") return ParamMapMode.LengthAngle;
    if (value == "yx") return ParamMapMode.YX;
    throw new Exception("unsupported physics map mode");
}

private void applyPhysicsSettings(SimplePhysics physics, ref JSONValue settings, bool requireAll) {
    if (requireAll || "model" in settings.object) physics.modelType = requirePhysicsModel(settings, "model");
    if (requireAll || "mapMode" in settings.object) physics.mapMode = requirePhysicsMapMode(settings, "mapMode");
    if (requireAll || "gravity" in settings.object) physics.gravity = requireJsonNumber(settings["gravity"]);
    if (requireAll || "length" in settings.object) physics.length = requireJsonNumber(settings["length"]);
    if (requireAll || "frequency" in settings.object) physics.frequency = requireJsonNumber(settings["frequency"]);
    if (requireAll || "angleDamping" in settings.object) physics.angleDamping = requireJsonNumber(settings["angleDamping"]);
    if (requireAll || "lengthDamping" in settings.object) physics.lengthDamping = requireJsonNumber(settings["lengthDamping"]);
    if (requireAll || "outputScale" in settings.object) physics.outputScale = requireJsonPair(settings, "outputScale");
    if (requireAll || "localOnly" in settings.object) physics.localOnly = requireJsonBool(settings, "localOnly");
    physics.reset();
}

private float requireJsonNumber(ref JSONValue value) {
    switch (value.type) {
        case JSONType.float_: return cast(float) value.floating;
        case JSONType.integer: return cast(float) value.integer;
        case JSONType.uinteger: return cast(float) value.uinteger;
        default: throw new Exception("expected finite numeric value");
    }
}

private vec2 requireJsonPair(ref JSONValue object, string key) {
    if (object.type != JSONType.object || key !in object.object || object[key].type != JSONType.array || object[key].array.length != 2) throw new Exception("missing or invalid numeric pair field: " ~ key);
    auto x = requireJsonNumber(object[key].array[0]);
    auto y = requireJsonNumber(object[key].array[1]);
    if (!isFinite(x) || !isFinite(y)) throw new Exception("numeric pair must be finite");
    return vec2(x, y);
}

private MeshData requireJsonMesh(ref JSONValue operation) {
    if (operation.type != JSONType.object || "mesh" !in operation.object || operation["mesh"].type != JSONType.object) throw new Exception("missing or invalid mesh field");
    auto meshObject = operation["mesh"];
    if ("vertices" !in meshObject.object || meshObject["vertices"].type != JSONType.array ||
        "uvs" !in meshObject.object || meshObject["uvs"].type != JSONType.array ||
        "indices" !in meshObject.object || meshObject["indices"].type != JSONType.array) throw new Exception("mesh requires vertices, uvs, and indices");
    if (meshObject["vertices"].array.length == 0 || meshObject["vertices"].array.length != meshObject["uvs"].array.length || meshObject["indices"].array.length == 0 || meshObject["indices"].array.length % 3 != 0) throw new Exception("invalid mesh cardinality");
    MeshData mesh;
    foreach (ref vertex; meshObject["vertices"].array) {
        if (vertex.type != JSONType.array || vertex.array.length != 2) throw new Exception("mesh vertex must be a numeric pair");
        auto x = requireJsonNumber(vertex.array[0]);
        auto y = requireJsonNumber(vertex.array[1]);
        if (!isFinite(x) || !isFinite(y)) throw new Exception("mesh vertex must be finite");
        mesh.vertices ~= vec2(x, y);
    }
    foreach (ref uv; meshObject["uvs"].array) {
        if (uv.type != JSONType.array || uv.array.length != 2) throw new Exception("mesh UV must be a numeric pair");
        auto x = requireJsonNumber(uv.array[0]);
        auto y = requireJsonNumber(uv.array[1]);
        if (!isFinite(x) || !isFinite(y)) throw new Exception("mesh UV must be finite");
        mesh.uvs ~= vec2(x, y);
    }
    foreach (ref indexValue; meshObject["indices"].array) {
        ulong index;
        switch (indexValue.type) {
            case JSONType.uinteger: index = indexValue.uinteger; break;
            case JSONType.integer:
                if (indexValue.integer < 0) throw new Exception("mesh index must be non-negative");
                index = cast(ulong) indexValue.integer;
                break;
            case JSONType.float_:
                if (!isFinite(indexValue.floating) || indexValue.floating < 0 || indexValue.floating != cast(ulong) indexValue.floating) throw new Exception("mesh index must be a non-negative integer");
                index = cast(ulong) indexValue.floating;
                break;
            default: throw new Exception("mesh index must be a non-negative integer");
        }
        if (index >= mesh.vertices.length || index > uint.max) throw new Exception("mesh index is outside vertex range");
        mesh.indices ~= cast(uint) index;
    }
    return mesh;
}

private int requireJsonDimensions(ref JSONValue object) {
    if (object.type != JSONType.object || "dimensions" !in object.object) throw new Exception("missing parameter dimensions");
    auto dimensions = requireJsonNumber(object["dimensions"]);
    if (dimensions != 1 && dimensions != 2) throw new Exception("parameter dimensions must be 1 or 2");
    return cast(int) dimensions;
}

private Parameter resolveParameterName(Puppet puppet, string name) {
    Parameter found;
    size_t matches;
    foreach (parameter; puppet.parameters) if (parameter.name.value == name) { found = parameter; matches++; }
    return matches == 1 ? found : null;
}

private bool hasParameterName(Puppet puppet, string name) {
    foreach (parameter; puppet.parameters) if (parameter.name.value == name) return true;
    return false;
}

private bool findExactKeypoint(Parameter parameter, vec2 requested, out vec2u index) {
    enum tolerance = 0.000001f;
    foreach (x; 0 .. parameter.axisPointCount(0)) {
        foreach (y; 0 .. parameter.axisPointCount(1)) {
            auto candidate = parameter.getKeypointValue(vec2u(cast(uint) x, cast(uint) y));
            if (abs(candidate.x - requested.x) <= tolerance && abs(candidate.y - requested.y) <= tolerance) {
                index = vec2u(cast(uint) x, cast(uint) y);
                return true;
            }
        }
    }
    return false;
}

export extern(C) nothrow @nogc uint iat_bridge_abi_version() { return 1; }
export extern(C) nothrow @nogc const(char)* iat_bridge_upstream_version() { return upstreamVersion.ptr; }
export extern(C) void iat_string_free(char* value) nothrow { if (value !is null) free(value); }

export extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null; *outError = null;
    if (path is null) { *outError = copyCString("puppet path is null"); return 2; }
    try {
        auto puppetPath = fromStringz(path).idup;
        auto puppet = inLoadPuppet!Puppet(puppetPath);
        scope(exit) destroy(puppet);
        return returnInspectionJson(puppet, outJson, outError);
    } catch (Throwable error) { *outError = copyCString(error.msg.idup); return 1; }
}

export extern(C) int iat_create_minimal_puppet_json(const(char)* outputPath, const(char)* name, char** outJson, char** outError) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null; *outError = null;
    if (outputPath is null || name is null) { *outError = copyCString("output path and puppet name are required"); return 2; }
    try {
        auto output = fromStringz(outputPath).idup;
        auto nameText = fromStringz(name).idup;
        if (nameText.strip.length == 0 || toLower(extension(output)) != ".inp") { *outError = copyCString("invalid minimal puppet authoring request"); return 4; }
        if (exists(output)) { *outError = copyCString("puppet output already exists"); return 5; }
        auto parent = dirName(output);
        if (parent.length > 0) mkdirRecurse(parent);
        auto puppet = new Puppet();
        scope(exit) destroy(puppet);
        puppet.meta.name = nameText;
        inWriteINPPuppet(puppet, output);
        if (!exists(output) || getSize(output) == 0) { *outError = copyCString("official writer produced no puppet artifact"); return 1; }
        auto reopened = inLoadPuppet!Puppet(output);
        scope(exit) destroy(reopened);
        if (reopened is null || reopened.meta.name.value != nameText) { *outError = copyCString("saved puppet did not preserve requested metadata"); return 6; }
        return returnInspectionJson(reopened, outJson, outError);
    } catch (Throwable error) { *outError = copyCString(error.msg.idup); return 1; }
}

export extern(C) int iat_edit_visual_puppet_json(const(char)* inputPath, const(char)* outputPath, const(char)* operationsJson, char** outJson, char** outError) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null; *outError = null;
    if (inputPath is null || outputPath is null || operationsJson is null) return fail(outError, 2, "input path, output path, and operations are required");
    string output;
    bool outputWritten;
    try {
        auto input = fromStringz(inputPath).idup;
        output = fromStringz(outputPath).idup;
        auto operationsText = fromStringz(operationsJson).idup;
        if (toLower(extension(input)) != ".inp" || toLower(extension(output)) != ".inp" || input == output) return fail(outError, 5, "visual authoring requires distinct .inp input/output paths");
        if (exists(output)) return fail(outError, 5, "puppet output already exists");
        auto operations = parseJSON(operationsText);
        if (operations.type != JSONType.array || operations.array.length == 0) return fail(outError, 2, "visual authoring operations must be a non-empty array");
        auto puppet = inLoadPuppet!Puppet(input);
        scope(exit) destroy(puppet);
        auto initialTextureCount = puppet.textureCache is null ? 0UL : cast(ulong) puppet.textureCache.size;
        Texture[string] texturesByKey;
        size_t importedTextureCount;
        foreach (ref operation; operations.array) {
            auto type = requireJsonString(operation, "type");
            if (type == "texture.import") {
                auto key = requireJsonString(operation, "key");
                auto imagePath = requireJsonString(operation, "imagePath");
                if (key.strip.length == 0 || (key in texturesByKey) !is null || toLower(extension(imagePath)) != ".png" || !exists(imagePath)) return fail(outError, 9, "invalid texture asset or duplicate texture key");
                TextureData data;
                try {
                    auto encoded = cast(ubyte[]) read(imagePath);
                    auto ownedEncoded = cast(ubyte[]) encoded.nu_dup();
                    data = TextureData.load(ownedEncoded);
                } catch (Throwable error) { return fail(outError, 9, "failed decoding PNG texture asset"); }
                if (data.width == 0 || data.height == 0 || data.data.length == 0) { data.free(); return fail(outError, 9, "decoded texture asset is empty"); }
                auto texture = Texture.createForData(data);
                puppet.textureCache.add(texture);
                texturesByKey[key] = texture;
                importedTextureCount++;
                continue;
            }
            if (type == "node.create") {
                auto parentPath = requireJsonString(operation, "parentPath");
                auto name = requireJsonString(operation, "name");
                auto parent = resolveNodePath(puppet, parentPath);
                if (parent is null || name.strip.length == 0 || hasSiblingNamed(parent, name)) return fail(outError, 7, "invalid or ambiguous hierarchy target");
                auto node = new Node(parent); node.name = name; continue;
            }
            if (type == "part.create") {
                auto parentPath = requireJsonString(operation, "parentPath");
                auto name = requireJsonString(operation, "name");
                auto textureKey = requireJsonString(operation, "textureKey");
                auto parent = resolveNodePath(puppet, parentPath);
                if (parent is null || name.strip.length == 0 || hasSiblingNamed(parent, name)) return fail(outError, 7, "invalid or ambiguous hierarchy target");
                auto texturePtr = textureKey in texturesByKey;
                if (texturePtr is null) return fail(outError, 8, "unknown transaction-local texture key");
                auto texture = *texturePtr;
                MeshData mesh;
                float halfW = texture.width / 2.0f;
                float halfH = texture.height / 2.0f;
                mesh.vertices = [vec2(-halfW, -halfH), vec2(halfW, -halfH), vec2(halfW, halfH), vec2(-halfW, halfH)];
                mesh.uvs = [vec2(0, 1), vec2(1, 1), vec2(1, 0), vec2(0, 0)];
                mesh.indices = [0u, 1u, 2u, 2u, 3u, 0u];
                auto part = new Part(mesh, [texture], parent); part.name = name; continue;
            }
            if (type == "node.reparent") {
                auto path = requireJsonString(operation, "path");
                auto newParentPath = requireJsonString(operation, "newParentPath");
                auto node = resolveNodePath(puppet, path);
                auto newParent = resolveNodePath(puppet, newParentPath);
                if (node is null || newParent is null || node is puppet.root || wouldCreateCycle(node, newParent) || hasSiblingNamed(newParent, node.name.value, node)) return fail(outError, 7, "invalid hierarchy reparent");
                node.parent = newParent; continue;
            }
            if (type == "node.remove") {
                auto path = requireJsonString(operation, "path");
                auto node = resolveNodePath(puppet, path);
                if (node is null || node is puppet.root || node.parent is null) return fail(outError, 7, "invalid hierarchy removal");
                node.parent = null; continue;
            }
            if (type == "part.setTexture") {
                auto path = requireJsonString(operation, "path");
                auto textureKey = requireJsonString(operation, "textureKey");
                auto part = cast(Part) resolveNodePath(puppet, path);
                if (part is null) return fail(outError, 7, "texture target is not a Part");
                auto texturePtr = textureKey in texturesByKey;
                if (texturePtr is null) return fail(outError, 8, "unknown transaction-local texture key");
                auto texture = *texturePtr;
                if (part.textures[0] !is texture) {
                    if (part.textures[0] !is null) part.textures[0].release();
                    texture.retain(); part.textures[0] = texture;
                }
                continue;
            }
            if (type == "part.setMesh") {
                auto path = requireJsonString(operation, "path");
                auto part = cast(Part) resolveNodePath(puppet, path);
                if (part is null) return fail(outError, 7, "mesh target is not a Part");
                auto meshData = requireJsonMesh(operation);
                auto replacement = Mesh.fromMeshData(meshData);
                part.mesh = replacement;
                replacement.release();
                continue;
            }
            if (type == "deformer.create") {
                auto kind = requireJsonString(operation, "kind");
                auto parentPath = requireJsonString(operation, "parentPath");
                auto name = requireJsonString(operation, "name");
                if (kind != "mesh") return fail(outError, 2, "unsupported deformer kind");
                auto parent = resolveNodePath(puppet, parentPath);
                if (parent is null || name.strip.length == 0 || hasSiblingNamed(parent, name)) return fail(outError, 7, "invalid or ambiguous deformer hierarchy target");
                auto meshData = requireJsonMesh(operation);
                auto deformer = new MeshDeformer(parent);
                deformer.name = name;
                auto replacement = Mesh.fromMeshData(meshData);
                deformer.mesh = replacement;
                replacement.release();
                continue;
            }
            if (type == "deformer.setMesh") {
                auto path = requireJsonString(operation, "path");
                auto deformer = cast(MeshDeformer) resolveNodePath(puppet, path);
                if (deformer is null) return fail(outError, 7, "mesh target is not a MeshDeformer");
                auto meshData = requireJsonMesh(operation);
                auto replacement = Mesh.fromMeshData(meshData);
                deformer.mesh = replacement;
                replacement.release();
                continue;
            }
            if (type == "physics.create") {
                auto parentPath = requireJsonString(operation, "parentPath");
                auto name = requireJsonString(operation, "name");
                auto parameterName = requireJsonString(operation, "parameterName");
                auto parent = resolveNodePath(puppet, parentPath);
                auto parameter = resolveParameterName(puppet, parameterName);
                if (parent is null || parameter is null || name.strip.length == 0 || hasSiblingNamed(parent, name)) return fail(outError, 10, "invalid physics parent, name, or target parameter");
                auto physics = new SimplePhysics(parent);
                physics.name = name;
                physics.param = parameter;
                applyPhysicsSettings(physics, operation, true);
                continue;
            }
            if (type == "physics.update") {
                auto path = requireJsonString(operation, "path");
                auto physics = cast(SimplePhysics) resolveNodePath(puppet, path);
                if (physics is null) return fail(outError, 10, "physics update target is not SimplePhysics");
                if ("parameterName" in operation.object) {
                    auto parameter = resolveParameterName(puppet, requireJsonString(operation, "parameterName"));
                    if (parameter is null) return fail(outError, 10, "physics target parameter does not exist");
                    physics.param = parameter;
                }
                if ("settings" !in operation.object || operation["settings"].type != JSONType.object) return fail(outError, 10, "physics update settings must be an object");
                auto settings = operation["settings"];
                applyPhysicsSettings(physics, settings, false);
                continue;
            }
            if (type == "physics.remove") {
                auto path = requireJsonString(operation, "path");
                auto physics = cast(SimplePhysics) resolveNodePath(puppet, path);
                if (physics is null || physics.parent is null) return fail(outError, 10, "physics remove target is not SimplePhysics");
                physics.parent = null;
                continue;
            }
            if (type == "parameter.create") {
                auto name = requireJsonString(operation, "name");
                auto dimensions = requireJsonDimensions(operation);
                auto minValue = requireJsonPair(operation, "min");
                auto maxValue = requireJsonPair(operation, "max");
                auto defaultValue = requireJsonPair(operation, "defaultValue");
                if (name.strip.length == 0 || hasParameterName(puppet, name) || minValue.x >= maxValue.x || defaultValue.x < minValue.x || defaultValue.x > maxValue.x || (dimensions == 1 && (minValue.y != 0 || maxValue.y != 0 || defaultValue.y != 0)) || (dimensions == 2 && (minValue.y >= maxValue.y || defaultValue.y < minValue.y || defaultValue.y > maxValue.y))) return fail(outError, 10, "invalid or duplicate parameter definition");
                auto parameter = new Parameter(name, dimensions == 2);
                parameter.min = minValue; parameter.max = maxValue; parameter.defaults = defaultValue; parameter.value = defaultValue;
                puppet.parameters ~= parameter;
                continue;
            }
            if (type == "parameter.bind") {
                auto parameterName = requireJsonString(operation, "parameterName");
                auto targetPath = requireJsonString(operation, "targetPath");
                auto property = requireJsonString(operation, "property");
                auto parameter = resolveParameterName(puppet, parameterName);
                auto target = resolveNodePath(puppet, targetPath);
                if (parameter is null || target is null || !target.hasParam(property) || parameter.hasBinding(target, property)) return fail(outError, 10, "invalid parameter binding target or property");
                if ("keypoints" !in operation.object || operation["keypoints"].type != JSONType.array || operation["keypoints"].array.length == 0) return fail(outError, 10, "parameter binding requires keypoints");
                auto valueBinding = cast(ValueParameterBinding) parameter.getOrAddBinding(target, property, false);
                if (valueBinding is null) return fail(outError, 10, "unsupported parameter binding type");
                vec2u[] assigned;
                foreach (ref keypoint; operation["keypoints"].array) {
                    auto at = requireJsonPair(keypoint, "at");
                    if ("value" !in keypoint.object) return fail(outError, 10, "binding keypoint is missing value");
                    auto value = requireJsonNumber(keypoint["value"]);
                    if (!isFinite(value)) return fail(outError, 10, "binding keypoint value must be finite");
                    vec2u index;
                    if (!findExactKeypoint(parameter, at, index)) return fail(outError, 10, "binding keypoint does not match an existing parameter axis point");
                    foreach (previous; assigned) if (previous == index) return fail(outError, 10, "duplicate binding keypoint");
                    assigned ~= index;
                    valueBinding.setValue(index, value);
                }
                continue;
            }
            if (type == "parameter.unbind") {
                auto parameterName = requireJsonString(operation, "parameterName");
                auto targetPath = requireJsonString(operation, "targetPath");
                auto property = requireJsonString(operation, "property");
                auto parameter = resolveParameterName(puppet, parameterName);
                auto target = resolveNodePath(puppet, targetPath);
                if (parameter is null || target is null || !target.hasParam(property)) return fail(outError, 10, "invalid parameter binding target or property");
                auto binding = parameter.getBinding(target, property);
                if (binding is null) return fail(outError, 10, "parameter binding does not exist");
                parameter.removeBinding(binding);
                continue;
            }
            return fail(outError, 2, "unsupported visual authoring operation");
        }
        string[string] expectedPartTextureByPath;
        collectPartTextureExpectations(puppet.root, "/" ~ puppet.root.name.value, expectedPartTextureByPath);
        auto parentDir = dirName(output);
        if (parentDir.length > 0) mkdirRecurse(parentDir);
        inWriteINPPuppet(puppet, output);
        outputWritten = exists(output);
        if (!outputWritten || getSize(output) == 0) { safeRemove(output); return fail(outError, 1, "official writer produced no puppet artifact"); }
        auto reopened = inLoadPuppet!Puppet(output);
        scope(exit) destroy(reopened);
        if (reopened is null || reopened.textureCache is null || reopened.textureCache.size != initialTextureCount + importedTextureCount) {
            safeRemove(output); outputWritten = false; return fail(outError, 6, "visual authoring round-trip texture inventory mismatch");
        }
        foreach (path, expectedRef; expectedPartTextureByPath) {
            auto node = resolveNodePath(reopened, path);
            auto part = cast(Part) node;
            if (part is null || part.textures[0] is null || textureFingerprint(part.textures[0]) != expectedRef) {
                safeRemove(output); outputWritten = false; return fail(outError, 6, "visual authoring round-trip Part relationship mismatch");
            }
        }
        return returnInspectionJson(reopened, outJson, outError);
    } catch (Throwable error) {
        if (outputWritten) safeRemove(output);
        return fail(outError, 1, error.msg.idup);
    }
}
