import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = resolve(root, '.deps/inochi2d-current');
const manifest = JSON.parse(readFileSync(resolve(root, 'native/current-patches/manifest.json'), 'utf8'));
const applied = new Set();

function replaceExact(id, relativePath, before, after, expectedCount = 1) {
  const path = resolve(sourceDir, relativePath);
  let source = readFileSync(path, 'utf8');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(before, offset);
    if (index < 0) break;
    count += 1;
    offset = index + before.length;
  }
  if (count !== expectedCount) {
    throw new Error(`${id}: expected ${expectedCount} exact match(es) in ${relativePath}, found ${count}`);
  }
  source = source.split(before).join(after);
  writeFileSync(path, source);
  applied.add(id);
}

replaceExact(
  'inp2-bool-decode',
  'modules/inp/source/inp/format/inp2/reader.d',
  `        case INP2_TAG_UINT:
            node = DataNode(reader.readU32LE());
            return null;
`,
  `        case INP2_TAG_BOOL:
            node = DataNode(reader.readU32LE() != 0);
            return null;

        case INP2_TAG_UINT:
            node = DataNode(reader.readU32LE());
            return null;
`,
);

replaceExact(
  'inp2-container-terminators',
  'modules/inp/source/inp/format/inp2/reader.d',
  `                node ~= value.move();
            }
            return null;

        case INP2_TAG_OBJECT_BEGIN:
`,
  `                node ~= value.move();
            }
            if (reader.readU32LE() != INP2_TAG_ARRAY_END)
                return "Malformed array terminator";
            return null;

        case INP2_TAG_OBJECT_BEGIN:
`,
);

replaceExact(
  'inp2-container-terminators',
  'modules/inp/source/inp/format/inp2/reader.d',
  `                    nu_freea(key);
                }
            }
            return null;
`,
  `                    nu_freea(key);
                }
            }
            if (reader.readU32LE() != INP2_TAG_OBJECT_END)
                return "Malformed object terminator";
            return null;
`,
);

for (const [before, after, expectedCount = 1] of [
  [
    `            DataNode result;
            toSerialize.serialize(result);
`,
    `            DataNode result = DataNode.createObject();
            toSerialize.serialize(result);
`,
  ],
  [
    `            DataNode result;
            toSerialize.onSerialize(result);
`,
    `            DataNode result = DataNode.createObject();
            toSerialize.onSerialize(result);
`,
    2,
  ],
  [
    `            DataNode obj;
            toSerialize.onSerialize(obj);
            return obj;
`,
    `            DataNode obj = DataNode.createObject();
            toSerialize.onSerialize(obj);
            return obj;
`,
  ],
]) {
  replaceExact('serde-object-initialization', 'source/inochi2d/core/serde.d', before, after, expectedCount);
}

replaceExact(
  'serde-fixed-vector-deserialization',
  'source/inochi2d/core/serde.d',
  `    } else static if (__traits(isStaticArray, T)) {
`,
  `    } else static if (isVector!T) {
        if (!data.isArray)
            return;

        foreach (i, ref value; data.array) {
            if (i >= destination.data.length)
                break;
            destination.data[i] = value.deserialize!(typeof(destination.data[0]), ST)(state);
        }
    } else static if (__traits(isStaticArray, T)) {
`,
);

replaceExact(
  'legacy-parameter1d-axis-upgrade',
  'source/inochi2d/param/parameters/param1d.d',
  `        super.onDeserialize(object, state);
        object.tryGetRef(state, min, "min");
        object.tryGetRef(state, max, "max");
        object.tryGetRef(state, defaults, "defaults");

        // 0.8->0.9 upgrades
        if (state.doUpgrade08) {
            state.info("0.8->0.9: Upgrading 1D axis mapping...");
            object.tryGetRef(state, points, "axis_points");
            return;
        }

        object.tryGetRef(state, points, "points");
`,
  `        super.onDeserialize(object, state);

        // 0.8 stores 1D scalar bounds/defaults as vec2 and axis_points as [x, y].
        if (state.doUpgrade08) {
            state.info("0.8->0.9: Upgrading 1D bounds and axis mapping...");
            if (auto legacyMin = "min" in object) {
                if ((*legacyMin).isArray) (*legacyMin).tryGetRef(state, min, 0);
                else object.tryGetRef(state, min, "min");
            }
            if (auto legacyMax = "max" in object) {
                if ((*legacyMax).isArray) (*legacyMax).tryGetRef(state, max, 0);
                else object.tryGetRef(state, max, "max");
            }
            if (auto legacyDefaults = "defaults" in object) {
                if ((*legacyDefaults).isArray) (*legacyDefaults).tryGetRef(state, defaults, 0);
                else object.tryGetRef(state, defaults, "defaults");
            }
            if (auto legacyAxes = "axis_points" in object) {
                if ((*legacyAxes).isArray) {
                    (*legacyAxes).tryGetRef(state, points, 0);
                    foreach (ref point; points)
                        point = min + (max - min) * point;
                }
            }
            return;
        }

        object.tryGetRef(state, min, "min");
        object.tryGetRef(state, max, "max");
        object.tryGetRef(state, defaults, "defaults");
        object.tryGetRef(state, points, "points");
`,
);

replaceExact(
  'parameter-explicit-type',
  'source/inochi2d/param/parameters/param1d.d',
  `        super.onSerialize(object);
        object["min"] = min.serialize();
`,
  `        super.onSerialize(object);
        object["type"] = "1d";
        object["min"] = min.serialize();
`,
);

replaceExact(
  'parameter-explicit-type',
  'source/inochi2d/param/parameters/param2d.d',
  `        super.onSerialize(object);
        object["min"] = min.serialize();
`,
  `        super.onSerialize(object);
        object["type"] = "2d";
        object["min"] = min.serialize();
`,
);



replaceExact(
  'parameter-guid-roundtrip',
  'source/inochi2d/param/parameters/package.d',
  `        guid = object.tryGetGUID(state, "uuid");
`,
  `        // Prefer an authored GUID when both modern guid and legacy uuid are present.
        // Stable 0.8.7 compatibility artifacts intentionally carry both; references such
        // as SimplePhysics.target point at the GUID, so downgrading identity to uuid here
        // would sever those semantic links. Truly legacy artifacts still fall back to uuid.
        if (auto authoredGuid = "guid" in object)
            guid = (*authoredGuid).tryGetGUID(state);
        else
            guid = object.tryGetGUID(state, "uuid");
`,
);

replaceExact(
  'parameter-binding-serialization',
  'source/inochi2d/param/parameters/package.d',
  `        // object["bindings"] = bindings.serialize();
`,
  `        object["bindings"] = bindings.serialize();
`,
);

replaceExact(
  'property-binding-compatibility',
  'source/inochi2d/param/bindings/package.d',
  `ParameterBinding tryDeserializeBinding(ref DataNode object, ref ModelState state, Parameter param) @nogc {
    //if (state.doUpgrade08) {
    //    if (auto prop = object.tryGet!string(state, "param_name", null)) {
    //        state.info(nstring("0.8->0.9: upgrading binding ", prop, "..."));
    //        auto binding = prop == "deform" ?
    //            nogc_new!ParameterDeformBinding(param) :
    //            nogc_new!ParameterPropertyBinding(param);

    //        binding.deserialize(object, state);
    //        return cast(ParameterBinding)binding;
    //    }

    //    state.warning(nstring("0.8->0.9: Encountered a unnamed binding, ignoring..."));
    //    return null;
    //}

    //if (auto binding = in_binding_registry.tryCreateFrom(object, param)) {
    //    binding.deserialize(object, state);
    //    return binding;
    //}

    state.warning(nstring("Encountered untyped binding, ignoring..."));
    return null;
}
`,
  `ParameterBinding tryDeserializeBinding(ref DataNode object, ref ModelState state, Parameter param) @nogc {
    if (state.doUpgrade08) {
        if (auto prop = object.tryGet!string(state, "param_name", null)) {
            if (prop == "deform") {
                state.warning("0.8->0.9: deformation bindings remain unsupported by the current compatibility lane");
                return null;
            }
            state.info(nstring("0.8->0.9: upgrading property binding ", prop, "..."));
            auto binding = nogc_new!ParameterPropertyBinding(param);
            binding.deserialize(object, state);
            return cast(ParameterBinding)binding;
        }

        state.warning("0.8->0.9: encountered unnamed binding, ignoring...");
        return null;
    }

    if (auto type = object.tryGet!string(state, "type", null)) {
        if (type == "property") {
            auto binding = nogc_new!ParameterPropertyBinding(param);
            binding.deserialize(object, state);
            return cast(ParameterBinding)binding;
        }
    }

    state.warning("Encountered unsupported binding type, ignoring...");
    return null;
}
`,
);

replaceExact(
  'property-binding-compatibility',
  'source/inochi2d/param/bindings/property.d',
  `//mixin Register!(ParameterPropertyBinding, in_binding_registry);
`,
  `//mixin Register!(ParameterPropertyBinding, in_binding_registry);

/**
    Compatibility implementation for scalar node-property bindings.

    This intentionally restores only the ordinary semantic property-binding
    surface required by inochi-agent-tools. Deformation bindings remain
    unsupported and therefore fail closed in tryDeserializeBinding.
*/
class ParameterPropertyBinding : ParameterBinding {
private:
@nogc:
    GUID nodeId;
    Node target_;
    vector2d!bool defined_;
    vector2d!float values_;
    nstring prop_;
    quark propKey_;

    ref bool definedAt(vec2u index) {
        if (parameter.dimensions == 1)
            return defined_[0, index.x];
        return defined_[index.x, index.y];
    }

    ref float valueAt(vec2u index) {
        if (parameter.dimensions == 1)
            return values_[0, index.x];
        return values_[index.x, index.y];
    }

    bool validIndex(vec2u index) {
        if (parameter.dimensions == 1)
            return parameter.elementCounts.length == 1 && index.x < parameter.elementCounts[0];
        return parameter.elementCounts.length == 2 &&
            index.x < parameter.elementCounts[0] && index.y < parameter.elementCounts[1];
    }

    void applyValue(float value) {
        if (target_ !is null && propKey_ != 0)
            target_.setProperty(propKey_, value);
    }

protected:
    override
    void onSerialize(ref DataNode object) {
        super.onSerialize(object);
        object["type"] = "property";
        if (target_ !is null)
            object["target"] = target_.guid.toString()[];
        object["property"] = prop_[];
        object["defined"] = defined_.data.serialize();
        object["values"] = values_.data.serialize();
    }

    override
    void onDeserialize(ref DataNode object, ref ModelState state) {
        super.onDeserialize(object, state);
        defined_.resizeToParam(parameter);
        values_.resizeToParam(parameter);

        if (state.doUpgrade08) {
            nodeId = object.tryGetGUID(state, "node", "target");
            object.tryGetRef(state, prop_, "param_name");
            if ("isSet" in object) {
                object["isSet"].deserialize08NestedArrays(
                    defined_,
                    state,
                    parameter.dimensions == 1 ?
                        vec2u(1, parameter.elementCounts[0]) :
                        vec2u(parameter.elementCounts[0], parameter.elementCounts[1])
                );
            }
            if ("values" in object) {
                object["values"].deserialize08NestedArrays(
                    values_,
                    state,
                    parameter.dimensions == 1 ?
                        vec2u(1, parameter.elementCounts[0]) :
                        vec2u(parameter.elementCounts[0], parameter.elementCounts[1])
                );
            }
        } else {
            nodeId = object.tryGetGUID(state, "node", "target");
            object.tryGetRef(state, prop_, "property");
            if (auto serializedDefined = "defined" in object) {
                if ((*serializedDefined).isArray) {
                    foreach (i, ref value; (*serializedDefined).array) {
                        if (i >= defined_.data.length) break;
                        defined_.data[i] = value.deserialize!bool(state);
                    }
                }
            }
            if (auto serializedValues = "values" in object) {
                if ((*serializedValues).isArray) {
                    foreach (i, ref value; (*serializedValues).array) {
                        if (i >= values_.data.length) break;
                        values_.data[i] = value.deserialize!float(state);
                    }
                }
            }
        }
        propKey_ = nu_quarkof(prop_[]);
    }

    override
    void onFinalize(Puppet puppet, ref ModelState state) {
        super.onFinalize(puppet, state);
        target_ = puppet.find!Node(nodeId);
        propKey_ = nu_quarkof(prop_[]);
        if (target_ is null)
            state.warning(nstring("property binding target was not found for ", prop_[]));
        else if (!target_.hasProperty(propKey_))
            state.warning(nstring("property binding target does not expose ", prop_[]));
    }

public:
    this(Parameter param) {
        super(param);
        defined_.resizeToParam(param);
        values_.resizeToParam(param);
    }

    @property Node target() => target_;
    @property string property() => prop_[];

    override
    void apply(vec2u index, vec2 norm) {
        if (target_ is null || !target_.hasProperty(propKey_))
            return;

        if (parameter.dimensions == 1) {
            if (parameter.elementCounts.length != 1 || parameter.elementCounts[0] < 2)
                return;
            auto lo = vec2u(index.x, 0);
            auto hi = vec2u(index.x + 1, 0);
            if (!validIndex(lo) || !validIndex(hi))
                return;
            if (definedAt(lo) && definedAt(hi))
                applyValue(valueAt(lo) + (valueAt(hi) - valueAt(lo)) * norm.x);
            else if (definedAt(lo))
                applyValue(valueAt(lo));
            else if (definedAt(hi))
                applyValue(valueAt(hi));
            return;
        }

        auto p00 = vec2u(index.x, index.y);
        auto p10 = vec2u(index.x + 1, index.y);
        auto p01 = vec2u(index.x, index.y + 1);
        auto p11 = vec2u(index.x + 1, index.y + 1);
        if (!validIndex(p00) || !validIndex(p10) || !validIndex(p01) || !validIndex(p11))
            return;

        if (definedAt(p00) && definedAt(p10) && definedAt(p01) && definedAt(p11)) {
            float top = valueAt(p00) + (valueAt(p10) - valueAt(p00)) * norm.x;
            float bottom = valueAt(p01) + (valueAt(p11) - valueAt(p01)) * norm.x;
            applyValue(top + (bottom - top) * norm.y);
        }
    }

    override void insertKeypoint(ParameterAxis axis, uint index) {
        assert(false, "current compatibility property binding does not mutate axis topology");
    }
    override void moveKeypoint(ParameterAxis axis, uint index, uint dest) {
        assert(false, "current compatibility property binding does not mutate axis topology");
    }
    override void deleteKeypoint(ParameterAxis axis, uint index) {
        assert(false, "current compatibility property binding does not mutate axis topology");
    }
    override void scaleKeypoint(ParameterAxis axis, uint index, float scale) {
        assert(false, "current compatibility property binding does not mutate axis topology");
    }

    override
    void copyKeypoint(vec2u index, ParameterBinding other, vec2u dest) {
        auto propertyBinding = cast(ParameterPropertyBinding)other;
        if (!validIndex(index) || propertyBinding is null || !propertyBinding.validIndex(dest))
            return;
        propertyBinding.definedAt(dest) = definedAt(index);
        propertyBinding.valueAt(dest) = valueAt(index);
    }

    override
    void clear() {
        defined_[] = false;
    }

    override
    void enable(vec2u index) {
        if (!validIndex(index))
            return;
        definedAt(index) = true;
        reset(index);
    }

    override
    void reset(vec2u index) {
        if (!validIndex(index))
            return;
        valueAt(index) = target_ !is null && target_.hasProperty(propKey_) ?
            target_.getPropertyDefault(propKey_) : 0;
    }

    override
    void disable(vec2u index) {
        if (validIndex(index))
            definedAt(index) = false;
    }

    override void fillBlanks() {
    }

    override
    bool isDefined(uint index) const {
        return index < defined_.data.length && defined_.data[index];
    }

    override
    bool isCompatibleWith(Node other) const {
        return other !is null && propKey_ != 0 && other.hasProperty(propKey_);
    }
}
`,
);

replaceExact(
  'simplephysics-late-parameter-resolution',
  'source/inochi2d/nodes/legacy/simplephysics.d',
  `    GUID paramRef = GUID.nil;
    PhysicsModel modelType_ = PhysicsModel.Pendulum;
    Parameter param_;
    vec2 output;
`,
  `    GUID paramRef = GUID.nil;
    PhysicsModel modelType_ = PhysicsModel.Pendulum;
    Parameter param_;
    vec2 output;

    Parameter resolveParam() {
        if (param_ !is null || paramRef == GUID.nil || puppet is null)
            return param_;

        param_ = puppet.findParameter(paramRef);
        if (param_ !is null)
            return param_;

        auto targetGuid = paramRef.toString();
        foreach (candidate; puppet.parameters) {
            auto candidateGuid = candidate.guid.toString();
            if (candidateGuid[] == targetGuid[]) {
                param_ = candidate;
                break;
            }
        }
        return param_;
    }
`,
);

replaceExact(
  'simplephysics-late-parameter-resolution',
  'source/inochi2d/nodes/legacy/simplephysics.d',
  `    @property Parameter param() => param_;
    @property void param(Parameter p) {
        this.param_ = p;
        this.paramRef = param_ ? param_.guid : GUID.nil;
    }
`,
  `    @property Parameter param() => resolveParam();
    @property void param(Parameter p) {
        this.param_ = p;
        this.paramRef = param_ ? param_.guid : GUID.nil;
    }
`,
);

replaceExact(
  'simplephysics-late-parameter-resolution',
  'source/inochi2d/nodes/legacy/simplephysics.d',
  `    @property Parameter[] affectedParameters() @nogc => (&param_)[0 .. 1];
`,
  `    @property Parameter[] affectedParameters() @nogc {
        resolveParam();
        return (&param_)[0 .. 1];
    }
`,
);

for (const patch of manifest.patches) {
  if (!applied.has(patch.id)) throw new Error(`declared current patch was not applied: ${patch.id}`);
}
console.log(`applied ${manifest.patches.length} isolated current-upstream compatibility patches`);
