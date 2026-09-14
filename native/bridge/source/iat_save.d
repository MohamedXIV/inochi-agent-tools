module iat_save;

import core.stdc.stdlib : malloc;
import core.stdc.string : memcpy;
import inochi2d.core.format.inp : inLoadPuppet, inWriteINPPuppet;
import inochi2d.core.puppet : Puppet;
import std.file : exists, getSize, mkdirRecurse, remove;
import std.path : dirName, extension;
import std.string : fromStringz;
import std.uni : toLower;

private char* copyCString(string value) nothrow {
    auto memory = cast(char*) malloc(value.length + 1);
    if (memory is null) return null;
    if (value.length > 0) memcpy(memory, value.ptr, value.length);
    memory[value.length] = '\0';
    return memory;
}

private void safeRemove(string path) nothrow {
    try {
        if (path.length > 0 && exists(path)) remove(path);
    } catch (Throwable) {
    }
}

private int fail(char** outError, int code, string message) nothrow {
    if (outError !is null) *outError = copyCString(message);
    return code;
}

export extern(C) int iat_save_puppet(
    const(char)* inputPath,
    const(char)* outputPath,
    char** outError,
) nothrow {
    if (outError is null) return 2;
    *outError = null;
    if (inputPath is null || outputPath is null) {
        return fail(outError, 2, "input path and output path are required");
    }

    string output;
    bool outputWritten;
    try {
        auto input = fromStringz(inputPath).idup;
        output = fromStringz(outputPath).idup;
        if (
            toLower(extension(input)) != ".inp" ||
            toLower(extension(output)) != ".inp" ||
            input == output
        ) {
            return fail(outError, 4, "save-as requires distinct .inp input/output paths");
        }
        if (exists(output)) return fail(outError, 5, "puppet output already exists");

        auto puppet = inLoadPuppet!Puppet(input);
        scope(exit) destroy(puppet);

        auto parent = dirName(output);
        if (parent.length > 0) mkdirRecurse(parent);
        inWriteINPPuppet(puppet, output);
        outputWritten = exists(output);
        if (!outputWritten || getSize(output) == 0) {
            safeRemove(output);
            return fail(outError, 1, "official writer produced no puppet artifact");
        }

        auto reopened = inLoadPuppet!Puppet(output);
        scope(exit) destroy(reopened);
        if (reopened is null || reopened.meta.name.value != puppet.meta.name.value) {
            safeRemove(output);
            return fail(outError, 6, "saved puppet did not preserve requested metadata");
        }
        return 0;
    } catch (Throwable error) {
        if (outputWritten) safeRemove(output);
        return fail(outError, 1, error.msg.idup);
    }
}
