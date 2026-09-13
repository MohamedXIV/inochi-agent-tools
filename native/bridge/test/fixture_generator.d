import inochi2d.core.puppet : Puppet, PuppetMeta;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.mesh : MeshData;
import inochi2d.core.param : Parameter;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inmath : vec2;
import nulib.string : nstring;
import std.file : exists, getSize, mkdirRecurse;
import std.json : JSONValue, parseJSON, toJSON;
import std.path : dirName;
import std.stdio : stderr;
import std.uni : toLower;

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("fixture-generator: expected output .inp path");
        return 2;
    }

    try {
        stderr.writeln("fixture-generator: construct puppet");
        auto puppet = new Puppet();
        puppet.meta.name = "M1 Inspection Fixture";
        stderr.writeln("fixture-generator: assigned meta name=", puppet.meta.name.value);
        if (puppet.meta.name.value != "M1 Inspection Fixture") {
            stderr.writeln("fixture-generator: direct metadata assignment mismatch");
            return 10;
        }

        auto face = new Node(puppet.root);
        face.name = "Face";

        // Part(Node) leaves Drawable.mesh unset in pinned Inochi2D. Use the
        // MeshData constructor so official serialization has a valid mesh.
        auto mouth = new Part(MeshData.init, [], face);
        mouth.name = "Mouth";

        auto headX = new Parameter("Head X", false);
        headX.min = vec2(-1, 0);
        headX.max = vec2(1, 0);
        headX.defaults = vec2(0, 0);
        puppet.parameters ~= headX;

        // Diagnostic regression: separate NuLib assignment, JSON text/parse,
        // and Inochi Parameter.onDeserialize so the failing ownership boundary
        // is identified before adding another compatibility patch.
        stderr.writeln("fixture-generator: probe direct nstring assignment");
        nstring directName;
        directName.opAssign("Head X");
        stderr.writeln("fixture-generator: direct name length=", directName.length, " value=", directName.value);
        if (directName.value != "Head X") {
            stderr.writeln("fixture-generator: direct nstring assignment mismatch");
            return 8;
        }

        stderr.writeln("fixture-generator: probe parameter serde");
        JSONValue parameterJson;
        headX.onSerialize(parameterJson);
        auto parameterText = parameterJson.toJSON();
        stderr.writeln("fixture-generator: serialized parameter=", parameterText);
        auto parsedParameterJson = parseJSON(parameterText);
        stderr.writeln("fixture-generator: parsed name=", parsedParameterJson["name"].str);
        if (parsedParameterJson["name"].str != "Head X") {
            stderr.writeln("fixture-generator: parsed JSON parameter name mismatch");
            return 9;
        }

        auto parameterProbe = new Parameter();
        parameterProbe.onDeserialize(parsedParameterJson);
        stderr.writeln(
            "fixture-generator: probe name length=", parameterProbe.name.length,
            " value=", parameterProbe.name.value
        );
        if (parameterProbe.name.value != "Head X") {
            stderr.writeln("fixture-generator: probe parameter name mismatch");
            return 6;
        }
        if (parameterProbe.name.value.toLower != "head x") {
            stderr.writeln("fixture-generator: probe lowercase mismatch");
            return 7;
        }

        stderr.writeln("fixture-generator: probe metadata serde");
        JSONValue metaJson;
        puppet.meta.onSerialize(metaJson);
        auto metaText = metaJson.toJSON();
        stderr.writeln("fixture-generator: serialized metadata=", metaText);
        auto parsedMetaJson = parseJSON(metaText);
        stderr.writeln("fixture-generator: parsed metadata name=", parsedMetaJson["name"].str);
        if (parsedMetaJson["name"].str != "M1 Inspection Fixture") {
            stderr.writeln("fixture-generator: parsed JSON metadata name mismatch");
            return 11;
        }
        auto metaProbe = new PuppetMeta();
        metaProbe.onDeserialize(parsedMetaJson);
        stderr.writeln("fixture-generator: probe metadata name=", metaProbe.name.value);
        if (metaProbe.name.value != "M1 Inspection Fixture") {
            stderr.writeln("fixture-generator: probe metadata name mismatch");
            return 12;
        }

        stderr.writeln("fixture-generator: serialize puppet");
        mkdirRecurse(dirName(args[1]));
        inWriteINPPuppet(puppet, args[1]);

        if (!exists(args[1]) || getSize(args[1]) == 0) {
            stderr.writeln("fixture-generator: serialization produced no artifact");
            return 3;
        }

        stderr.writeln("fixture-generator: reload puppet");
        auto loaded = inLoadPuppet!Puppet(args[1]);
        if (loaded is null) {
            stderr.writeln("fixture-generator: reload returned null");
            return 4;
        }
        if (loaded.meta.name != "M1 Inspection Fixture") {
            stderr.writeln("fixture-generator: reloaded metadata mismatch: ", loaded.meta.name);
            return 5;
        }

        stderr.writeln("fixture-generator: success");
        return 0;
    } catch (Throwable error) {
        stderr.writeln("fixture-generator: exception: ", error.msg);
        stderr.writeln(error.info);
        return 1;
    }
}
