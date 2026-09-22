export interface AdapterImage {
  base64: string;
  mimeType: string;
}

export interface AdapterResult {
  data: any;
  images?: AdapterImage[];
}

export interface ToolAdapter {
  readonly name: string;
  readonly tools: string[];
  getSchema(tool: string): null;
  execute(tool: string, args: any, ctx: { invocationId: string; workspaceRoot: string }): Promise<AdapterResult>;
}
