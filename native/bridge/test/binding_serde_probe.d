import inmath : vec2, vec2u;
import inochi2d.core.format : deserialize, parseJSON, serialize, toJSON;
import inochi2d.core.nodes : Node;
import inochi2d.core.param : Parameter, ValueParameterBinding;
import inochi2d.core.puppet : Puppet;
import std.stdio : stderr;

int main() {
    try {
        auto puppet = new Puppet();
        auto rig = new Node(puppet.root);
        rig.name = "Rig";

        auto parameter = new Parameter("Move X", false);
        parameter.min = vec2(-1, 0);
        parameter.max = vec2(1, 0);
        parameter.defaults = vec2(0, 0);
        puppet.parameters ~= parameter;

        auto binding = cast(ValueParameterBinding) parameter.getOrAddBinding(rig, "transform.t.x", false);
        assert(binding !is null);
        binding.setValue(vec2u(0, 0), -20);
        binding.setValue(vec2u(1, 0), 20);

        auto encodedValue = parameter.serialize();
        auto encoded = encodedValue.toJSON();
        stderr.writeln("binding-serde-probe: JSON=", encoded);

        auto parsed = parseJSON(encoded);
        auto decoded = new Parameter();
        stderr.writeln("binding-serde-probe: deserialize parameter");
        parsed.deserialize(decoded);
        stderr.writeln("binding-serde-probe: decoded bindings=", decoded.bindings.length);
        if (decoded.bindings.length != 1) return 3;
        return 0;
    } catch (Throwable error) {
        stderr.writeln("binding-serde-probe: exception: ", error.msg);
        stderr.writeln(error.info);
        return 2;
    }
}
