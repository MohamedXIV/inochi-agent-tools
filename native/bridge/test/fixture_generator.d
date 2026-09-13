import inochi2d.core.puppet : Puppet;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.param : Parameter;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inochi2d.core.math : vec2;
import std.file : exists, getSize, mkdirRecurse;
import std.path : dirName;

int main(string[] args) {
    assert(args.length == 2, "expected output .inp path");

    auto puppet = new Puppet();
    puppet.meta.name = "M1 Inspection Fixture";

    auto face = new Node(puppet.root);
    face.name = "Face";

    auto mouth = new Part(face);
    mouth.name = "Mouth";

    auto headX = new Parameter("Head X", false);
    headX.min = vec2(-1, 0);
    headX.max = vec2(1, 0);
    headX.defaults = vec2(0, 0);
    puppet.parameters ~= headX;

    mkdirRecurse(dirName(args[1]));
    inWriteINPPuppet(puppet, args[1]);

    assert(exists(args[1]));
    assert(getSize(args[1]) > 0);

    auto loaded = inLoadPuppet!Puppet(args[1]);
    assert(loaded !is null);
    assert(loaded.meta.name == "M1 Inspection Fixture");
    return 0;
}
