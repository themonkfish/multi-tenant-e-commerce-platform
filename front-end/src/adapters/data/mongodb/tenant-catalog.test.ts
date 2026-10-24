import { describe, expect, it } from "vitest";
import { validateMongoConnectionString } from "./tenant-catalog";

describe("validateMongoConnectionString", () => {
  it("accepts secure MongoDB Atlas SRV URIs", () => {
    expect(() =>
      validateMongoConnectionString(
        "mongodb+srv://catalog-user:secret@cluster0.ab12.mongodb.net/?retryWrites=true",
      ),
    ).not.toThrow();
  });

  it.each([
    "mongodb://127.0.0.1:27017/catalog",
    "mongodb+srv://user:secret@localhost/",
    "mongodb+srv://user:secret@cluster.mongodb.net.evil.example/",
    "mongodb+srv://user:secret@cluster.ab12.mongodb.net/?tls=false",
    "mongodb+srv://user:secret@cluster.ab12.mongodb.net/?ssl=false",
    "mongodb+srv://user:secret@cluster.ab12.mongodb.net/?tlsAllowInvalidHostnames=true",
  ])("rejects unsafe URI %s", (connectionString) => {
    expect(() => validateMongoConnectionString(connectionString)).toThrow();
  });
});
