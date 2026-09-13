module iat_bridge;

import inochi2d.ver : IN_VERSION;

private enum upstreamVersion = IN_VERSION ~ "\0";

export extern(C) nothrow @nogc uint iat_bridge_abi_version() {
    return 1;
}

export extern(C) nothrow @nogc const(char)* iat_bridge_upstream_version() {
    return upstreamVersion.ptr;
}
