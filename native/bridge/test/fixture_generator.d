import inochi2d.core.puppet : Puppet;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.mesh : MeshData;
import inochi2d.core.param : Parameter;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inmath : vec2;
import std.file : exists, getSize, mkdirRecurse;
import std.path : dirName;
import std.stdio : stderr;

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("fixture-generator: expected output .inp path");
        return 2;
    }

    try {
        stderr.writeln("fixture-generator: construct puppet");
        auto puppet = new Puppet();
        puppet.meta.name = "M1 Inspection Fixture";

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
