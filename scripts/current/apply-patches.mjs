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

    }
}
`,
  `                    nu_freea(key);
                }
            }
            if (reader.readU32LE() != INP2_TAG_OBJECT_END)
                return "Malformed object terminator";
            return null;

    }
}
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

for (const patch of manifest.patches) {
  if (!applied.has(patch.id)) throw new Error(`declared current patch was not applied: ${patch.id}`);
}
console.log(`applied ${manifest.patches.length} isolated current-upstream compatibility patches`);
