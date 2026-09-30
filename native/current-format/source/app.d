import inochi2d;
import inochi2d.param.parameters : Parameter1D;
import inochi2d.param.bindings.property : ParameterPropertyBinding;
import inochi2d.nodes.deformer.meshdeformer : MeshDeformer;
import inochi2d.nodes.legacy.simplephysics : SimplePhysics, PhysicsModel, ParamMapMode;
import nulib : nu_quarkof;
import inp.format;
import nulib.io.stream.file : FileStream;
import numem : nogc_delete, nogc_new;
import std.file : exists, remove;
import std.stdio : stderr, writeln;

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

bool assertFixture(string path) {
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
    if (physics is null || physics.param is null || physics.param.name != "Head X" ||
        physics.modelType != PhysicsModel.Pendulum || physics.mapMode != ParamMapMode.AngleLength ||
        !physics.localOnly || physics.gravity != 1 || physics.length != 100 ||
        physics.frequency != 1 || physics.angleDamping != 0.5 || physics.lengthDamping != 0.5 ||
        physics.outputScale.x != 1 || physics.outputScale.y != 1) {
        stderr.writeln("current-format-probe: representative SimplePhysics semantics did not survive migration");
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
    if (args.length != 4) {
        stderr.writeln("usage: iat_current_format_probe input.inp output.inp roundtrip.inp");
        return 2;
    }
    if (!assertFixture(args[1])) return 3;
    if (!writeCurrent(args[1], args[2])) return 4;
    if (!assertFixture(args[2])) return 5;
    if (!writeCurrent(args[2], args[3])) return 6;
    if (!assertFixture(args[3])) return 7;
    writeln("{\"ok\":true,\"format\":\"INP2\",\"parameters\":[\"Head X\",\"Head Y\",\"Visibility\",\"Face Tint R\"],\"bindingProperties\":[\"transform.t.x\",\"transform.t.y\",\"opacity\",\"tint.r\"],\"runtimeBindingEvaluation\":true,\"physics\":\"SimplePhysics\",\"meshDeformer\":\"CurrentRigCage\",\"setReadbackRestore\":true,\"nodes\":[\"Face\",\"HairFront\"],\"minTextureSlots\":2}");
    return 0;
}
