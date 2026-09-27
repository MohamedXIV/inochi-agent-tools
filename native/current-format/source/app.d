import inochi2d;
import inochi2d.param.parameters : Parameter1D;
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
        if (parameter.elementCounts.length != 1 || parameter.elementCounts[0] != 2) {
            stderr.writeln("current-format-probe: 1D axis points were not preserved for ", name);
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
    writeln("{\"ok\":true,\"format\":\"INP2\",\"parameters\":[\"Head X\",\"Head Y\"],\"setReadbackRestore\":true,\"nodes\":[\"Face\",\"HairFront\"],\"minTextureSlots\":2}");
    return 0;
}
