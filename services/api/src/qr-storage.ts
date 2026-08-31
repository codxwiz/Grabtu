import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type QrStorageObject = { buffer: Buffer; contentType: string };

export interface QrStorage {
  ensureReady(): Promise<void>;
  put(key: string, object: QrStorageObject): Promise<void>;
  get(key: string): Promise<QrStorageObject | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string | null;
}

type StorageProvider = "local" | "s3";

const LOCAL_UPLOAD_DIR = process.env.UPLOAD_DIR || process.env.QR_STORAGE_LOCAL_DIR || "./data/uploads";

function contentTypeForKey(key: string) {
  const extension = path.extname(key).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function encodePathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string) {
  return value.replace(/^\/+/, "");
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data).digest();
}

function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

class LocalQrStorage implements QrStorage {
  constructor(private readonly uploadDir: string) {}

  async ensureReady() {
    await mkdir(this.uploadDir, { recursive: true });
  }

  private filePath(key: string) {
    return path.join(this.uploadDir, path.basename(key));
  }

  async put(key: string, object: QrStorageObject) {
    await writeFile(this.filePath(key), object.buffer, { flag: "wx" });
  }

  async get(key: string) {
    try {
      const buffer = await readFile(this.filePath(key));
      return { buffer, contentType: contentTypeForKey(key) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await unlink(this.filePath(key)).catch(() => {});
  }

  publicUrl() {
    return null;
  }
}

class S3QrStorage implements QrStorage {
  private readonly endpointUrl: URL;
  private readonly publicBaseUrl: string | null;
  private readonly basePath: string;

  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly region: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    publicBaseUrl?: string | null,
  ) {
    this.endpointUrl = new URL(endpoint);
    this.basePath = this.endpointUrl.pathname === "/" ? "" : this.endpointUrl.pathname.replace(/\/+$/, "");
    this.publicBaseUrl = publicBaseUrl ? normalizeBaseUrl(publicBaseUrl) : null;
  }

  async ensureReady() {
    for (const [name, value] of [
      ["S3_ENDPOINT", this.endpoint],
      ["S3_BUCKET", this.bucket],
      ["S3_REGION", this.region],
      ["S3_ACCESS_KEY_ID", this.accessKeyId],
      ["S3_SECRET_ACCESS_KEY", this.secretAccessKey],
    ] as const) {
      if (!value) throw new Error(`${name} is required when QR_STORAGE_PROVIDER=s3`);
    }
  }

  publicUrl(key: string) {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${encodePathSegment(key)}` : null;
  }

  private objectPath(key: string) {
    const encodedKey = trimLeadingSlash(key)
      .split("/")
      .filter(Boolean)
      .map(encodePathSegment)
      .join("/");
    return `${this.basePath}/${encodePathSegment(this.bucket)}${encodedKey ? `/${encodedKey}` : ""}`;
  }

  private objectUrl(key: string) {
    return `${this.endpointUrl.origin}${this.objectPath(key)}`;
  }

  private signingKey(dateStamp: string) {
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  private async signedRequest(method: "GET" | "PUT" | "DELETE" | "HEAD", key: string, body?: Buffer, contentType?: string) {
    const payload = body ?? Buffer.alloc(0);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(payload);
    const headers: Record<string, string> = {
      host: this.endpointUrl.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    const sortedHeaderEntries = Object.entries(headers).sort(([left], [right]) => left.localeCompare(right));
    const canonicalHeaders = sortedHeaderEntries
      .map(([name, value]) => `${name.toLowerCase()}:${value.trim().replace(/\s+/g, " ")}\n`)
      .join("");
    const signedHeaders = sortedHeaderEntries.map(([name]) => name.toLowerCase()).join(";");
    const canonicalRequest = [
      method,
      this.objectPath(key),
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      `${dateStamp}/${this.region}/s3/aws4_request`,
      sha256(canonicalRequest),
    ].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    const response = await fetch(this.objectUrl(key), {
      method,
      headers: {
        ...headers,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(payload),
    });
    return response;
  }

  async put(key: string, object: QrStorageObject) {
    const response = await this.signedRequest("PUT", key, object.buffer, object.contentType);
    if (!response.ok) throw new Error(`Failed to upload QR image to object storage (${response.status})`);
  }

  async get(key: string) {
    const response = await this.signedRequest("GET", key);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch QR image from object storage (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      contentType: response.headers.get("content-type") || contentTypeForKey(key),
    };
  }

  async delete(key: string) {
    const response = await this.signedRequest("DELETE", key);
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete QR image from object storage (${response.status})`);
    }
  }
}

export function createQrStorage() {
  const provider = (process.env.QR_STORAGE_PROVIDER || "local").toLowerCase() as StorageProvider;
  if (provider === "s3") {
    return new S3QrStorage(
      process.env.S3_ENDPOINT || "",
      process.env.S3_BUCKET || "",
      process.env.S3_REGION || "",
      process.env.S3_ACCESS_KEY_ID || "",
      process.env.S3_SECRET_ACCESS_KEY || "",
      process.env.QR_STORAGE_PUBLIC_BASE_URL || process.env.S3_PUBLIC_BASE_URL || null,
    );
  }
  return new LocalQrStorage(LOCAL_UPLOAD_DIR);
}
