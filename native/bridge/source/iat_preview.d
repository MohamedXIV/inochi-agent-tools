module iat_preview;

import core.stdc.stdlib : malloc;
import core.stdc.string : memcpy;
import imagefmt : write_image;
import inochi2d.core.format.inp : inLoadPuppet;
import inochi2d.core.puppet : Puppet;
import inochi2d.core.render.drawlist : DrawState;
import inochi2d.core.render.texture : TextureFormat;
import std.algorithm : max, min;
import std.json : JSONValue, toJSON;
import std.math : ceil, floor, isFinite;
import std.string : fromStringz;

private char* copyCString(string value) nothrow {
    auto memory = cast(char*) malloc(value.length + 1);
    if (memory is null) return null;
    if (value.length > 0) memcpy(memory, value.ptr, value.length);
    memory[value.length] = '\0';
    return memory;
}

private int fail(char** outError, int code, string message) nothrow {
    if (outError !is null) *outError = copyCString(message);
    return code;
}

private JSONValue frameMetadata(Puppet puppet) {
    auto drawList = puppet.drawList;
    auto commands = drawList.commands;
    auto vertices = drawList.vertices;
    auto indices = drawList.indices;

    ulong drawableCommands;
    ulong texturedCommands;
    ulong normalCommands;
    ulong maskDefinitionCommands;
    ulong maskedCommands;
    ulong compositeCommands;
    foreach (ref command; commands) {
        if (command.elemCount > 0) drawableCommands++;
        if (command.sources[0] !is null) texturedCommands++;
        final switch (command.state) with (DrawState) {
            case normal: normalCommands++; break;
            case defineMask: maskDefinitionCommands++; break;
            case maskedDraw: maskedCommands++; break;
            case compositeBegin:
            case compositeEnd:
            case compositeBlit: compositeCommands++; break;
        }
    }

    bool hasBounds = vertices.length > 0;
    float minX, minY, maxX, maxY;
    if (hasBounds) {
        minX = maxX = vertices[0].vtx.x;
        minY = maxY = vertices[0].vtx.y;
        foreach (ref vertex; vertices[1 .. $]) {
            minX = min(minX, vertex.vtx.x);
            minY = min(minY, vertex.vtx.y);
            maxX = max(maxX, vertex.vtx.x);
            maxY = max(maxY, vertex.vtx.y);
        }
        hasBounds = isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY);
    }

    JSONValue result = JSONValue.emptyObject;
    result["schemaVersion"] = 1;
    result["kind"] = "inochi2d-draw-list-frame";
    result["commandCount"] = cast(ulong) commands.length;
    result["drawableCommandCount"] = drawableCommands;
    result["texturedCommandCount"] = texturedCommands;
    result["vertexCount"] = cast(ulong) vertices.length;
    result["indexCount"] = cast(ulong) indices.length;
    result["states"] = JSONValue.emptyObject;
    result["states"]["normal"] = normalCommands;
    result["states"]["defineMask"] = maskDefinitionCommands;
    result["states"]["maskedDraw"] = maskedCommands;
    result["states"]["composite"] = compositeCommands;
    result["hasRenderableContent"] = drawableCommands > 0 && vertices.length >= 3 && indices.length >= 3;
    if (hasBounds) {
        result["bounds"] = JSONValue.emptyObject;
        result["bounds"]["minX"] = minX;
        result["bounds"]["minY"] = minY;
        result["bounds"]["maxX"] = maxX;
        result["bounds"]["maxY"] = maxY;
    } else result["bounds"] = null;
    return result;
}

export extern(C) int iat_capture_preview_frame_json(const(char)* inputPath, char** outJson, char** outError) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null; *outError = null;
    if (inputPath is null) return fail(outError, 2, "input path is required");
    try {
        auto puppet = inLoadPuppet!Puppet(fromStringz(inputPath).idup);
        if (puppet is null) return fail(outError, 3, "failed loading puppet for preview capture");
        scope(exit) destroy(puppet);
        puppet.update(0.0f); puppet.draw(0.0f);
        *outJson = copyCString(frameMetadata(puppet).toJSON());
        return *outJson is null ? fail(outError, 1, "failed allocating preview frame JSON") : 0;
    } catch (Throwable error) return fail(outError, 1, "preview frame capture failed: " ~ error.msg);
}

private float edge(float ax, float ay, float bx, float by, float px, float py) {
    return (px-ax)*(by-ay) - (py-ay)*(bx-ax);
}

/** Deterministic CPU rasterizer for the normal textured DrawList subset. */
export extern(C) int iat_render_preview_png_json(
    const(char)* inputPath, const(char)* outputPath, uint width, uint height,
    char** outJson, char** outError,
) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null; *outError = null;
    if (inputPath is null || outputPath is null) return fail(outError, 2, "input and output paths are required");
    if (width < 16 || height < 16 || width > 4096 || height > 4096) return fail(outError, 2, "preview dimensions must be between 16 and 4096 pixels");
    try {
        auto puppet = inLoadPuppet!Puppet(fromStringz(inputPath).idup);
        if (puppet is null) return fail(outError, 3, "failed loading puppet for preview render");
        scope(exit) destroy(puppet);
        puppet.update(0.0f); puppet.draw(0.0f);
        auto dl = puppet.drawList;
        auto meta = frameMetadata(puppet);
        if (!meta["hasRenderableContent"].boolean) return fail(outError, 4, "preview frame has no renderable content");

        auto bounds = meta["bounds"];
        float minX = cast(float)bounds["minX"].floating;
        float minY = cast(float)bounds["minY"].floating;
        float maxX = cast(float)bounds["maxX"].floating;
        float maxY = cast(float)bounds["maxY"].floating;
        float spanX = max(maxX-minX, 0.001f), spanY = max(maxY-minY, 0.001f);
        float scale = min((width-16.0f)/spanX, (height-16.0f)/spanY);
        float ox = (width-spanX*scale)*0.5f-minX*scale;
        float oy = (height-spanY*scale)*0.5f+maxY*scale;
        ubyte[] pixels = new ubyte[cast(size_t)width*height*4];
        ulong triangles, coveredPixels;

        foreach (ref cmd; dl.commands) {
            if (cmd.elemCount == 0) continue;
            if (cmd.state != DrawState.normal) return fail(outError, 5, "preview renderer does not yet support masking/composite draw states");
            auto tex = cmd.sources[0];
            if (tex is null || tex.format != TextureFormat.rgba8Unorm || tex.width == 0 || tex.height == 0)
                return fail(outError, 5, "preview renderer requires RGBA8 source textures");
            auto src = cast(ubyte[])tex.pixels;
            foreach (i; 0 .. cmd.elemCount/3) {
                size_t io = cast(size_t)cmd.idxOffset + i*3;
                if (io+2 >= dl.indices.length) return fail(outError, 1, "draw-list index range is invalid");
                size_t ia = cast(size_t)cmd.vtxOffset + dl.indices[io], ib = cast(size_t)cmd.vtxOffset + dl.indices[io+1], ic = cast(size_t)cmd.vtxOffset + dl.indices[io+2];
                if (ia >= dl.vertices.length || ib >= dl.vertices.length || ic >= dl.vertices.length) return fail(outError, 1, "draw-list vertex range is invalid");
                auto a=dl.vertices[ia], b=dl.vertices[ib], c=dl.vertices[ic];
                float ax=ox+a.vtx.x*scale, ay=oy-a.vtx.y*scale, bx=ox+b.vtx.x*scale, by=oy-b.vtx.y*scale, cx=ox+c.vtx.x*scale, cy=oy-c.vtx.y*scale;
                float area=edge(ax,ay,bx,by,cx,cy); if (area == 0) continue;
                int x0=max(0,cast(int)floor(min(ax,min(bx,cx)))), x1=min(cast(int)width-1,cast(int)ceil(max(ax,max(bx,cx))));
                int y0=max(0,cast(int)floor(min(ay,min(by,cy)))), y1=min(cast(int)height-1,cast(int)ceil(max(ay,max(by,cy))));
                foreach (y; y0..y1+1) foreach (x; x0..x1+1) {
                    float px=x+0.5f, py=y+0.5f;
                    float wa=edge(bx,by,cx,cy,px,py)/area, wb=edge(cx,cy,ax,ay,px,py)/area, wc=1.0f-wa-wb;
                    if (wa < 0 || wb < 0 || wc < 0) continue;
                    float u=wa*a.uv.x+wb*b.uv.x+wc*c.uv.x, v=wa*a.uv.y+wb*b.uv.y+wc*c.uv.y;
                    uint tx=min(tex.width-1,cast(uint)max(0,cast(int)(u*(tex.width-1)+0.5f)));
                    uint ty=min(tex.height-1,cast(uint)max(0,cast(int)(v*(tex.height-1)+0.5f)));
                    size_t so=(cast(size_t)ty*tex.width+tx)*4, d=(cast(size_t)y*width+x)*4;
                    uint sa=src[so+3], inv=255-sa;
                    pixels[d]=(cast(uint)src[so]*sa+cast(uint)pixels[d]*inv)/255;
                    pixels[d+1]=(cast(uint)src[so+1]*sa+cast(uint)pixels[d+1]*inv)/255;
                    pixels[d+2]=(cast(uint)src[so+2]*sa+cast(uint)pixels[d+2]*inv)/255;
                    pixels[d+3]=cast(ubyte)min(255u,sa+(cast(uint)pixels[d+3]*inv)/255);
                    if (sa > 0) coveredPixels++;
                }
                triangles++;
            }
        }
        if (coveredPixels == 0) return fail(outError, 4, "preview rasterized to an empty image");
        write_image(fromStringz(outputPath).idup, width, height, pixels, 4);
        meta["kind"] = "inochi2d-headless-preview";
        meta["width"] = width; meta["height"] = height;
        meta["triangleCount"] = triangles; meta["coveredPixelSamples"] = coveredPixels;
        meta["output"] = fromStringz(outputPath).idup;
        *outJson = copyCString(meta.toJSON());
        return *outJson is null ? fail(outError,1,"failed allocating preview render JSON") : 0;
    } catch (Throwable error) return fail(outError,1,"preview render failed: " ~ error.msg);
}