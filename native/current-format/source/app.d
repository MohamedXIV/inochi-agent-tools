import inochi2d;
import inochi2d.param.parameters : Parameter1D;
import inochi2d.param.bindings.property : ParameterPropertyBinding;
import inochi2d.nodes.deformer.meshdeformer : MeshDeformer;
import inochi2d.nodes.legacy.simplephysics : SimplePhysics, PhysicsModel, ParamMapMode;
import nulib.quark : nu_quarkof;
import inp.format;
import nulib.io.stream.file : FileStream;
import numem : nogc_delete, nogc_new;
import std.file : exists, remove;
import std.stdio : stderr, writeln;
import std.conv : to;

bool writeCurrent(string inputPath, string outputPath) {
    auto input = nogc_new!FileStream(inputPath, "r+b");
    if (input is null) {
        stderr.writeln("current-format-probe: failed to open raw input");
        return false;
    }
    auto rawResult = input.readINP();
    if (!rawResult) {
        stderr.writeln("current-format-probe: readINP failed: ", rawResult.error);
        nogc_delete(input);
        return false;
    }
    DataNode raw = rawResult.get();
    nogc_delete(input);

    auto puppetResult = Puppet.fromFile(inputPath);
    if (!puppetResult) {
        stderr.writeln("current-format-probe: Puppet.fromFile failed: ", puppetResult.error);
        return false;
    }
    auto puppet = puppetResult.get();
    puppet.serialize(raw);

    if (exists(outputPath)) remove(outputPath);
    auto output = nogc_new!FileStream(outputPath, "w+b");
    if (output is null) {
        stderr.writeln("current-format-probe: failed to open output");
        return false;
    }
    output.writeINP(raw, INPFileFormat.inp2);
    nogc_delete(output);
    return true;
}

bool findRawPhysicsTarget(ref DataNode node, out string target, out string legacyParam) {
    if (!node.isObject) return false;
    if ("name" in node && node["name"].tryCoerce!string(null) == "CurrentPhysics") {
        target = "target" in node ? node["target"].tryCoerce!string(null) : null;
        if ("param" in node) {
            legacyParam = node["param"].isNumber
                ? node["param"].tryCoerce!ulong.to!string
                : node["param"].tryCoerce!string(null);
        }
        return true;
    }
    if ("children" in node && node["children"].isArray) {
        foreach (ref child; node["children"].array) {
            if (findRawPhysicsTarget(child, target, legacyParam)) return true;
        }
    }
    return false;
}

bool assertRawPhysicsLink(string path) {
    auto input = nogc_new!FileStream(path, "r+b");
    if (input is null) {
        stderr.writeln("current-format-probe: failed to open raw linkage input");
        return false;
    }
    auto rawResult = input.readINP();
    nogc_delete(input);
    if (!rawResult) {
        stderr.writeln("current-format-probe: raw linkage readINP failed: ", rawResult.error);
        return false;
    }
    DataNode raw = rawResult.get();
    if (INP_TAG_PAYLOAD !in raw || !raw[INP_TAG_PAYLOAD].isObject) {
        stderr.writeln("current-format-probe: raw linkage payload missing");
        return false;
    }
    auto payload = raw[INP_TAG_PAYLOAD];

    string physicsTarget;
    string legacyPhysicsParam;
    if ("nodes" !in payload || !findRawPhysicsTarget(payload["nodes"], physicsTarget, legacyPhysicsParam) ||
        physicsTarget is null) {
        stderr.writeln("current-format-probe: raw CurrentPhysics target is missing");
        return false;
    }

    string headGuid;
    string visibilityGuid;
    string headUuid;
    string visibilityUuid;
    if (auto parameters = "param" in payload) {
        if ((*parameters).isArray) {
            foreach (ref parameter; (*parameters).array) {
                if (!parameter.isObject || "name" !in parameter) continue;
                auto name = parameter["name"].tryCoerce!string(null);
                auto guid = "guid" in parameter ? parameter["guid"].tryCoerce!string(null) : null;
                string uuid;
                if ("uuid" in parameter && parameter["uuid"].isNumber)
                    uuid = parameter["uuid"].tryCoerce!ulong.to!string;
                if (name == "Head X") {
                    headGuid = guid;
                    headUuid = uuid;
                } else if (name == "Visibility") {
                    visibilityGuid = guid;
                    visibilityUuid = uuid;
                }
            }
        }
    }
    if (headGuid is null) {
        stderr.writeln("current-format-probe: raw Head X guid is missing");
        return false;
    }
    stderr.writeln("current-format-probe: raw identities CurrentPhysics target=", physicsTarget,
        " legacyParam=", legacyPhysicsParam is null ? "<absent>" : legacyPhysicsParam,
        " HeadX guid=", headGuid, " uuid=", headUuid is null ? "<absent>" : headUuid,
        " Visibility guid=", visibilityGuid is null ? "<missing>" : visibilityGuid,
        " uuid=", visibilityUuid is null ? "<absent>" : visibilityUuid);
    if (visibilityGuid !is null && visibilityGuid == headGuid) {
        stderr.writeln("current-format-probe: raw parameter GUID collision between Head X and Visibility");
        return false;
    }
    if (physicsTarget != headGuid) {
        stderr.writeln("current-format-probe: raw physics linkage mismatch: target=", physicsTarget,
            " parameterGuid=", headGuid);
        return false;
    }
    stderr.writeln("current-format-probe: raw physics linkage agrees: ", headGuid);
    return true;
}

Parameter1D find1D(Puppet puppet, string name) {
    foreach (parameter; puppet.parameters) {
        if (parameter.name == name)
            return cast(Parameter1D)parameter;
    }
    return null;
}

bool assertPropertyBindings(Parameter1D parameter, string property, string[] targetNames) {
    if (parameter.bindings.length != targetNames.length) {
        stderr.writeln("current-format-probe: binding count mismatch for ", parameter.name,
            " expected=", targetNames.length, " actual=", parameter.bindings.length);
        return false;
    }
    foreach (targetName; targetNames) {
        bool found;
        foreach (binding; parameter.bindings) {
            auto propertyBinding = cast(ParameterPropertyBinding)binding;
            if (propertyBinding !is null && propertyBinding.property == property &&
                propertyBinding.target !is null && propertyBinding.target.name == targetName) {
                found = true;
                break;
            }
        }
        if (!found) {
            stderr.writeln("current-format-probe: missing ", property, " binding from ",
                parameter.name, " to ", targetName);
            return false;
        }
    }
    return true;
}

bool assertRuntimeProperty(Puppet puppet, string parameterName, string targetName, string property) {
    auto parameter = find1D(puppet, parameterName);
    auto target = puppet.find(targetName);
    auto key = nu_quarkof(property);
    if (parameter is null || target is null || key == 0 || !target.hasProperty(key)) {
        stderr.writeln("current-format-probe: runtime property target missing for ",
            parameterName, " -> ", targetName, ".", property);
        return false;
    }
    float original = parameter.value;
    parameter.pushValue(-1);
    parameter.update();
    float low = target.getProperty(key);
    parameter.pushValue(1);
    parameter.update();
    float high = target.getProperty(key);
    parameter.pushValue(original);
    parameter.update();
    if (low == high) {
        stderr.writeln("current-format-probe: property binding did not evaluate for ",
            parameterName, " -> ", targetName, ".", property, " value=", low);
        return false;
    }
    return true;
}

bool assertRuntimeBindingRange(Puppet puppet, string parameterName, string targetName, string property) {
    auto parameter = find1D(puppet, parameterName);
    auto target = puppet.find(targetName);
    auto key = nu_quarkof(property);
    if (parameter is null || target is null || key == 0 || !target.hasProperty(key)) {
        stderr.writeln("current-format-probe: v2 runtime target missing for ",
            parameterName, " -> ", targetName, ".", property);
        return false;
    }

    float original = parameter.value;
    parameter.pushValue(parameter.min);
    parameter.update();
    float low = target.getProperty(key);
    if (parameter.currentValue.length != 1 || parameter.currentValue[0] != parameter.min) {
        stderr.writeln("current-format-probe: v2 set/readback failed at min for ", parameterName);
        return false;
    }

    parameter.pushValue(parameter.max);
    parameter.update();
    float high = target.getProperty(key);
    if (parameter.currentValue.length != 1 || parameter.currentValue[0] != parameter.max) {
        stderr.writeln("current-format-probe: v2 set/readback failed at max for ", parameterName);
        return false;
    }

    parameter.pushValue(original);
    parameter.update();
    if (parameter.currentValue.length != 1 || parameter.currentValue[0] != original) {
        stderr.writeln("current-format-probe: v2 restore failed for ", parameterName);
        return false;
    }
    if (low == high) {
        stderr.writeln("current-format-probe: v2 binding did not evaluate for ",
            parameterName, " -> ", targetName, ".", property);
        return false;
    }
    return true;
}

bool assertV2E2EFixture(string path) {
    auto result = Puppet.fromFile(path);
    if (!result) {
        stderr.writeln("current-format-probe: v2 e2e reload failed for ", path, ": ", result.error);
        return false;
    }
    auto puppet = result.get();

    foreach (name; ["body", "head", "hair"]) {
        if (puppet.find(name) is null) {
            stderr.writeln("current-format-probe: v2 e2e missing node ", name);
            return false;
        }
    }
    if (puppet.textureCache.size < 3) {
        stderr.writeln("current-format-probe: v2 e2e expected at least 3 textures, got ", puppet.textureCache.size);
        return false;
    }

    auto breathing = find1D(puppet, "Breathing");
    auto hairSwing = find1D(puppet, "Hair Swing");
    if (breathing is null || hairSwing is null) {
        stderr.writeln("current-format-probe: v2 e2e required parameters missing");
        return false;
    }
    if (!assertPropertyBindings(breathing, "transform.s.y", ["body", "head", "hair"])) return false;
    if (!assertPropertyBindings(hairSwing, "transform.r.z", ["hair"])) return false;
    if (!assertRuntimeBindingRange(puppet, "Breathing", "body", "transform.s.y")) return false;
    if (!assertRuntimeBindingRange(puppet, "Hair Swing", "hair", "transform.r.z")) return false;

    auto physics = cast(SimplePhysics)puppet.find("Hair Physics");
    if (physics is null || physics.param is null || physics.param.name != "Hair Swing") {
        stderr.writeln("current-format-probe: v2 e2e Hair Physics linkage missing");
        return false;
    }
    if (physics.modelType != PhysicsModel.Pendulum || physics.mapMode != ParamMapMode.AngleLength || !physics.localOnly) {
        stderr.writeln("current-format-probe: v2 e2e Hair Physics settings mismatch");
        return false;
    }
    return true;
}

bool assertFixture(string path) {
    if (!assertRawPhysicsLink(path)) return false;
    auto result = Puppet.fromFile(path);
    if (!result) {
        stderr.writeln("current-format-probe: reload failed for ", path, ": ", result.error);
        return false;
    }
    auto puppet = result.get();

    if (puppet.find("Face") is null || puppet.find("HairFront") is null) {
        stderr.writeln("current-format-probe: expected Face and HairFront nodes after migration");
        return false;
    }
    auto cage = cast(MeshDeformer)puppet.find("CurrentRigCage");
    if (cage is null || cage.mesh is null || cage.mesh.vertices.length != 4 || cage.mesh.indices.length != 6) {
        stderr.writeln("current-format-probe: representative mesh deformer did not survive migration");
        return false;
    }
    auto physics = cast(SimplePhysics)puppet.find("CurrentPhysics");
    if (physics is null) {
        stderr.writeln("current-format-probe: representative SimplePhysics node is missing");
        return false;
    }
    auto loadedHead = find1D(puppet, "Head X");
    auto loadedVisibility = find1D(puppet, "Visibility");
    if (loadedHead is null || loadedVisibility is null) {
        stderr.writeln("current-format-probe: expected Head X and Visibility parameters after migration");
        return false;
    }
    DataNode serializedPhysics = DataNode.createObject();
    physics.serialize(serializedPhysics, false);
    auto serializedTarget = "target" in serializedPhysics
        ? serializedPhysics["target"].tryCoerce!string(null)
        : null;
    auto loadedHeadGuid = loadedHead.guid.toString();
    if (serializedTarget is null || serializedTarget != loadedHeadGuid[]) {
        stderr.writeln("current-format-probe: post-load physics target mismatch: target=",
            serializedTarget is null ? "<missing>" : serializedTarget,
            " loadedHeadGuid=", loadedHeadGuid[]);
        return false;
    }
    if (physics.param is null) {
        auto visibilityGuid = loadedVisibility.guid.toString();
        stderr.writeln("current-format-probe: SimplePhysics parameter mismatch: name=<null>",
            " serializedTarget=", serializedTarget,
            " loadedHeadGuid=", loadedHeadGuid[],
            " loadedVisibilityGuid=", visibilityGuid[],
            " targetEqualsHead=true",
            " headEqualsVisibility=", loadedHead.guid == loadedVisibility.guid);
        return false;
    }
    if (physics.param.name != "Head X") {
        auto physicsGuid = physics.param.guid.toString();
        auto headGuid = loadedHead.guid.toString();
        auto visibilityGuid = loadedVisibility.guid.toString();
        stderr.writeln("current-format-probe: SimplePhysics parameter mismatch: name=",
            physics.param.name[],
            " physicsGuid=", physicsGuid[],
            " loadedHeadGuid=", headGuid[],
            " loadedVisibilityGuid=", visibilityGuid[],
            " headEqualsVisibility=", loadedHead.guid == loadedVisibility.guid,
            " physicsEqualsHead=", physics.param.guid == loadedHead.guid,
            " physicsEqualsVisibility=", physics.param.guid == loadedVisibility.guid);
        return false;
    }
    if (physics.modelType != PhysicsModel.Pendulum) {
        stderr.writeln("current-format-probe: SimplePhysics model mismatch: ", cast(string)physics.modelType);
        return false;
    }
    if (physics.mapMode != ParamMapMode.AngleLength) {
        stderr.writeln("current-format-probe: SimplePhysics map mode mismatch: ", cast(string)physics.mapMode);
        return false;
    }
    if (!physics.localOnly) {
        stderr.writeln("current-format-probe: SimplePhysics localOnly was not preserved");
        return false;
    }
    if (physics.gravity != 1 || physics.length != 100 || physics.frequency != 1 ||
        physics.angleDamping != 0.5 || physics.lengthDamping != 0.5 ||
        physics.outputScale.x != 1 || physics.outputScale.y != 1) {
        stderr.writeln("current-format-probe: SimplePhysics numeric mismatch: gravity=", physics.gravity,
            " length=", physics.length, " frequency=", physics.frequency,
            " angleDamping=", physics.angleDamping, " lengthDamping=", physics.lengthDamping,
            " outputScale=", physics.outputScale.x, ",", physics.outputScale.y);
        return false;
    }
    if (puppet.textureCache.size < 2) {
        stderr.writeln("current-format-probe: expected at least two preserved texture slots, got ", puppet.textureCache.size);
        return false;
    }

    foreach (name; ["Head X", "Head Y"]) {
        auto parameter = find1D(puppet, name);
        if (parameter is null) {
            stderr.writeln("current-format-probe: missing 1D parameter ", name);
            return false;
        }
        if (parameter.min != -1 || parameter.max != 1 || parameter.defaults != 0) {
            stderr.writeln("current-format-probe: bounds/default mismatch for ", name,
                " min=", parameter.min, " max=", parameter.max, " default=", parameter.defaults);
            return false;
        }
        if (parameter.elementCounts.length != 1 || parameter.elementCounts[0] != 2 ||
            parameter.points.length != 2 || parameter.points[0] != -1 || parameter.points[1] != 1) {
            stderr.writeln("current-format-probe: 1D axis points were not upgraded into parameter-value space for ", name);
            return false;
        }
        if (!assertPropertyBindings(
                parameter,
                name == "Head X" ? "transform.t.x" : "transform.t.y",
                ["Face", "HairFront"])) {
            return false;
        }
        float original = parameter.value;
        parameter.pushValue(0.5f);
        if (parameter.currentValue.length != 1 || parameter.currentValue[0] != 0.5f) {
            stderr.writeln("current-format-probe: set/readback failed for ", name);
            return false;
        }
        parameter.pushValue(original);
        if (parameter.currentValue[0] != original) {
            stderr.writeln("current-format-probe: restore failed for ", name);
            return false;
        }
    }

    auto visibility = find1D(puppet, "Visibility");
    auto tint = find1D(puppet, "Face Tint R");
    if (visibility is null || !assertPropertyBindings(visibility, "opacity", ["Face"])) return false;
    if (tint is null || !assertPropertyBindings(tint, "tint.r", ["Face"])) return false;

    if (!assertRuntimeProperty(puppet, "Head X", "Face", "transform.t.x")) return false;
    if (!assertRuntimeProperty(puppet, "Head Y", "Face", "transform.t.y")) return false;
    if (!assertRuntimeProperty(puppet, "Visibility", "Face", "opacity")) return false;
    if (!assertRuntimeProperty(puppet, "Face Tint R", "Face", "tint.r")) return false;
    return true;
}

int main(string[] args) {
    if (args.length == 3 && args[1] == "--v2-e2e-verify") {
        if (!assertV2E2EFixture(args[2])) return 8;
        writeln("{\"ok\":true,\"format\":\"INP2\",\"mode\":\"v2-e2e-verify\",\"nodes\":[\"body\",\"head\",\"hair\"],\"parameters\":[\"Breathing\",\"Hair Swing\"],\"bindings\":[\"transform.s.y\",\"transform.r.z\"],\"physics\":\"Hair Physics\",\"setReadbackRestore\":true}");
        return 0;
    }

    bool strictProduction = true;
    size_t inputIndex = 1;
    if (args.length == 5 && args[1] == "--conversion-only") {
        strictProduction = false;
        inputIndex = 2;
    } else if (args.length != 4) {
        stderr.writeln("usage: iat_current_format_probe [--conversion-only] input.inp output.inp roundtrip.inp | --v2-e2e-verify input.inp");
        return 2;
    }

    auto inputPath = args[inputIndex];
    auto outputPath = args[inputIndex + 1];
    auto roundtripPath = args[inputIndex + 2];

    // The default path is deliberately strict and fixture-specific for #47.
    // Downstream compatibility lanes may request conversion-only behavior, which
    // still performs real Puppet.fromFile -> serialize -> INP2 write twice but
    // does not impose #47's CurrentPhysics/Head X acceptance fixture contract.
    if (strictProduction && !assertFixture(inputPath)) return 3;
    if (!writeCurrent(inputPath, outputPath)) return 4;
    if (strictProduction && !assertFixture(outputPath)) return 5;
    if (!writeCurrent(outputPath, roundtripPath)) return 6;
    if (strictProduction && !assertFixture(roundtripPath)) return 7;

    if (strictProduction) {
        writeln("{\"ok\":true,\"format\":\"INP2\",\"mode\":\"production-acceptance\",\"parameters\":[\"Head X\",\"Head Y\",\"Visibility\",\"Face Tint R\"],\"bindingProperties\":[\"transform.t.x\",\"transform.t.y\",\"opacity\",\"tint.r\"],\"runtimeBindingEvaluation\":true,\"physics\":\"SimplePhysics\",\"meshDeformer\":\"CurrentRigCage\",\"setReadbackRestore\":true,\"nodes\":[\"Face\",\"HairFront\"],\"minTextureSlots\":2}");
    } else {
        writeln("{\"ok\":true,\"format\":\"INP2\",\"mode\":\"conversion-only\",\"saveReloadCycles\":2}");
    }
    return 0;
}
