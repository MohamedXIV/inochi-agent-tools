import inmath : vec2, vec2u;
import inochi2d.core.format : deserialize, parseJSON, serialize, toJSON;
import inochi2d.core.guid : GUID, toLegacyUUID, tryGetGUID;
import inochi2d.core.nodes : Node;
import inochi2d.core.param : Parameter, ValueParameterBinding;
import inochi2d.core.puppet : Puppet;
import std.json : JSONType;
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
        stderr.writeln("binding-serde-probe: parameter JSON=", encoded);

        auto parsed = parseJSON(encoded);
        auto decoded = new Parameter();
        stderr.writeln("binding-serde-probe: deserialize standalone parameter");
        parsed.deserialize(decoded);
        stderr.writeln("binding-serde-probe: decoded bindings=", decoded.bindings.length);
        if (decoded.bindings.length != 1) return 3;

        auto whole = puppet.serialize();
        if (whole["nodes"]["children"].array.length != 1 ||
            whole["param"].array.length != 1 ||
            whole["param"].array[0]["bindings"].array.length != 1) {
            stderr.writeln("binding-serde-probe: unexpected whole-puppet JSON shape: ", whole.toJSON());
            return 4;
        }

        auto rigObject = whole["nodes"]["children"].array[0];
        auto parameterObject = whole["param"].array[0];
        auto bindingObject = parameterObject["bindings"].array[0];

        auto serializedRigGuid = rigObject["guid"].str;
        auto serializedBindingGuid = bindingObject["target"].str;
        if (rigObject["uuid"].type != JSONType.uinteger ||
            parameterObject["uuid"].type != JSONType.uinteger ||
            bindingObject["node"].type != JSONType.uinteger) {
            stderr.writeln("binding-serde-probe: legacy identity fields are not unsigned integers");
            return 9;
        }

        auto serializedRigUuid = cast(uint)rigObject["uuid"].uinteger;
        auto serializedParameterUuid = cast(uint)parameterObject["uuid"].uinteger;
        auto serializedBindingUuid = cast(uint)bindingObject["node"].uinteger;
        stderr.writeln("binding-serde-probe: serialized Rig GUID=", serializedRigGuid);
        stderr.writeln("binding-serde-probe: serialized binding target GUID=", serializedBindingGuid);
        stderr.writeln("binding-serde-probe: serialized legacy node UUID=", serializedBindingUuid);
        if (serializedRigGuid != serializedBindingGuid ||
            serializedRigUuid != rig.guid.toLegacyUUID() ||
            serializedBindingUuid != serializedRigUuid ||
            serializedParameterUuid != parameter.guid.toLegacyUUID()) {
            stderr.writeln("binding-serde-probe: modern/legacy identity projection diverged before deserialize");
            return 5;
        }

        auto directRigGuid = GUID(serializedRigGuid);
        auto helperRigGuid = rigObject.tryGetGUID("uuid", "guid");
        auto helperBindingGuid = bindingObject.tryGetGUID("node", "target");
        stderr.writeln("binding-serde-probe: direct parsed Rig GUID=", directRigGuid.toString());
        stderr.writeln("binding-serde-probe: tryGetGUID Rig GUID=", helperRigGuid.toString());
        stderr.writeln("binding-serde-probe: tryGetGUID binding target GUID=", helperBindingGuid.toString());
        if (directRigGuid.toString().value != serializedRigGuid ||
            helperRigGuid != directRigGuid || helperBindingGuid != directRigGuid) {
            stderr.writeln("binding-serde-probe: modern GUID precedence diverged before Node deserialization");
            return 8;
        }

        auto reloaded = Puppet.deserialize(whole, null);
        scope(exit) destroy(reloaded);
        auto reloadedChildCount = reloaded.root.children.length;
        auto reloadedParameterCount = reloaded.parameters.length;
        auto reloadedBindingCount = reloadedParameterCount > 0 ? reloaded.parameters[0].bindings.length : 0;
        stderr.writeln("binding-serde-probe: reloaded counts children=", reloadedChildCount,
            " parameters=", reloadedParameterCount, " bindings=", reloadedBindingCount);
        if (reloadedChildCount != 1 || reloadedParameterCount != 1 || reloadedBindingCount != 1) {
            stderr.writeln("binding-serde-probe: unexpected reloaded puppet shape");
            return 6;
        }

        auto reloadedRig = reloaded.root.children[0];
        auto reloadedBinding = reloaded.parameters[0].bindings[0];
        auto reloadedTarget = reloadedBinding.getNode();
        stderr.writeln("binding-serde-probe: reloaded Rig GUID=", reloadedRig.guid.toString());
        stderr.writeln("binding-serde-probe: reloaded binding node GUID=", reloadedBinding.getNodeGUID().toString());
        stderr.writeln("binding-serde-probe: reloaded target name=", reloadedTarget is null ? "<null>" : reloadedTarget.name.value);
        if (reloadedTarget !is reloadedRig || reloadedRig.guid != directRigGuid) {
            stderr.writeln("binding-serde-probe: full-puppet deserialize did not preserve modern binding identity");
            return 7;
        }

        return 0;
    } catch (Throwable error) {
        stderr.writeln("binding-serde-probe: exception: ", error.msg);
        stderr.writeln(error.info);
        return 2;
    }
}