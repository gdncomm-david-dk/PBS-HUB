/** @jest-environment jsdom */
import { canvasPhotoFile } from "../shared/hostImage";
import { clockInOptions } from "../shared/clockInApp";

describe("canvas camera photo", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it("reads the quoted data URI from JSON(…, IncludeBinaryData) and a bare one", () => {
    const f = canvasPhotoFile(JSON.stringify(png), "selfie.jpg");
    expect(f?.type).toBe("image/png");
    expect(f?.size).toBe(8);
    expect(canvasPhotoFile(png, "s.jpg")?.name).toBe("s.jpg");
  });
  it("refuses links it cannot read", () => {
    expect(canvasPhotoFile('"appres://blobmanager/abc/1"', "s.jpg")).toBeNull();
    expect(canvasPhotoFile("", "s.jpg")).toBeNull();
  });
  it("selfieMode from config", () => {
    expect(clockInOptions({}).selfieMode).toBe("browser");
    expect(clockInOptions({ selfieMode: "Canvas" }).selfieMode).toBe("canvas");
  });
});
