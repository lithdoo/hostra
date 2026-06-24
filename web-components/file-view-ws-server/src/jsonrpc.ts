export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

export type JsonRpcHandler = (params: unknown, id: JsonRpcId | undefined) => Promise<unknown> | unknown;
export type JsonRpcHandlerMap = Record<string, JsonRpcHandler>;

export const JSON_RPC_ERRORS = {
  parseError: { code: -32700, message: 'Parse error' },
  invalidRequest: { code: -32600, message: 'Invalid Request' },
  methodNotFound: { code: -32601, message: 'Method not found' },
  internalError: { code: -32603, message: 'Internal error' },
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isObject(value)) {
    return false;
  }
  if (value.jsonrpc !== '2.0') {
    return false;
  }
  if (typeof value.method !== 'string' || value.method.length === 0) {
    return false;
  }
  if ('id' in value && !isValidId(value.id)) {
    return false;
  }
  if ('params' in value) {
    const params = value.params;
    const paramsValid = Array.isArray(params) || isObject(params);
    if (!paramsValid) {
      return false;
    }
  }
  return true;
}

export function createErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function parseJsonRpcMessage(raw: string): { request?: JsonRpcRequest; error?: JsonRpcErrorResponse } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      error: createErrorResponse(null, JSON_RPC_ERRORS.parseError.code, JSON_RPC_ERRORS.parseError.message),
    };
  }

  if (!isJsonRpcRequest(payload)) {
    return {
      error: createErrorResponse(
        null,
        JSON_RPC_ERRORS.invalidRequest.code,
        JSON_RPC_ERRORS.invalidRequest.message,
      ),
    };
  }

  return { request: payload };
}

export async function dispatchJsonRpc(
  request: JsonRpcRequest,
  handlers: JsonRpcHandlerMap,
): Promise<JsonRpcResponse | undefined> {
  const handler = handlers[request.method];
  if (!handler) {
    return request.id === undefined
      ? undefined
      : createErrorResponse(
          request.id ?? null,
          JSON_RPC_ERRORS.methodNotFound.code,
          JSON_RPC_ERRORS.methodNotFound.message,
        );
  }

  try {
    const result = await handler(request.params, request.id);
    if (request.id === undefined) {
      return undefined;
    }
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result,
    };
  } catch (error) {
    if (request.id === undefined) {
      return undefined;
    }
    return createErrorResponse(
      request.id ?? null,
      JSON_RPC_ERRORS.internalError.code,
      JSON_RPC_ERRORS.internalError.message,
      error instanceof Error ? error.message : error,
    );
  }
}
