export function isShadowReadOnlyContext(context) {
  return Boolean(
    context?.shadowMode === true ||
      context?.dryRun === true ||
      context?.allowWrites === false ||
      context?.allowExternalCalls === false,
  );
}

export function assertShadowWriteAllowed(context, boundary = "write") {
  if (isShadowReadOnlyContext(context) && context?.allowWrites === false) {
    const error = new Error("SHADOW_WRITE_BLOCKED");
    error.code = "SHADOW_WRITE_BLOCKED";
    error.boundary = boundary;
    throw error;
  }
}

export function assertShadowExternalCallsAllowed(
  context,
  boundary = "external_call",
) {
  if (
    isShadowReadOnlyContext(context) &&
    context?.allowExternalCalls === false
  ) {
    const error = new Error("SHADOW_EXTERNAL_CALL_BLOCKED");
    error.code = "SHADOW_EXTERNAL_CALL_BLOCKED";
    error.boundary = boundary;
    throw error;
  }
}

