import { isEpasVersionAtLeast } from "../src/utils/version";

describe("isEpasVersionAtLeast()", () => {
  const MIN = "0.7.0";

  it("is true for the exact minimum (0.7.0 >= 0.7.0)", () => {
    expect(isEpasVersionAtLeast("0.7.0", MIN)).toBe(true);
  });

  it("is false for the version just below (0.6.0 < 0.7.0)", () => {
    expect(isEpasVersionAtLeast("0.6.0", MIN)).toBe(false);
  });

  it("uses numeric semver ordering, not string compare (0.10.0 >= 0.7.0)", () => {
    // A naive string compare would rank "0.10.0" < "0.7.0" — it must not.
    expect(isEpasVersionAtLeast("0.10.0", MIN)).toBe(true);
  });

  it("is true for a higher major (1.0.0 >= 0.7.0)", () => {
    expect(isEpasVersionAtLeast("1.0.0", MIN)).toBe(true);
  });

  it("is true for a higher patch (0.7.1 >= 0.7.0)", () => {
    expect(isEpasVersionAtLeast("0.7.1", MIN)).toBe(true);
  });

  it('is false for the "n/a" placeholder', () => {
    expect(isEpasVersionAtLeast("n/a", MIN)).toBe(false);
  });

  it("is false when the version is missing (undefined)", () => {
    expect(isEpasVersionAtLeast(undefined, MIN)).toBe(false);
  });

  it("is false for a non-string value", () => {
    expect(isEpasVersionAtLeast(7 as unknown, MIN)).toBe(false);
  });

  it("is false for an unparseable string", () => {
    expect(isEpasVersionAtLeast("not-a-version", MIN)).toBe(false);
  });

  it("ignores a pre-release/build suffix on the core version", () => {
    expect(isEpasVersionAtLeast("0.7.0-rc.1", MIN)).toBe(true);
  });
});
