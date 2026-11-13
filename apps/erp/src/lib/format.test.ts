import { describe, expect, it } from "vitest";

import { clean } from "@/components/form";

import { qs } from "./api";
import { fmtDate, fmtMoney, fmtMoneyShort, fmtPercent, fmtSize } from "./format";
import { PROJECT_STATUS, labelOf, toneOf } from "./labels";

describe("format helpers (vi-VN)", () => {
  it("formats dates as dd/MM/yyyy and tolerates empty values", () => {
    expect(fmtDate("2026-11-03")).toBe("03/11/2026");
    expect(fmtDate(null)).toBe("—");
  });

  it("formats money in VND", () => {
    expect(fmtMoney("38500000000")).toBe("38.500.000.000 đ");
    expect(fmtMoneyShort("38500000000")).toBe("38,5 tỷ");
    expect(fmtMoneyShort(2500000)).toBe("2,5 triệu");
  });

  it("formats percent and file size", () => {
    expect(fmtPercent(57.94)).toBe("57,9%");
    expect(fmtSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("clean()", () => {
  it("sends empty dates and foreign keys as null but keeps empty text", () => {
    expect(clean({ project: "", start_date: "", submission_deadline: "", location: "", name: "A" })).toEqual({
      project: null,
      start_date: null,
      submission_deadline: null,
      location: "",
      name: "A",
    });
  });
});

describe("query string", () => {
  it("drops empty filters", () => {
    expect(qs({ q: "", page: 1, status: "in_progress,delayed", project: null })).toBe(
      "?page=1&status=in_progress%2Cdelayed"
    );
  });
});

describe("labels", () => {
  it("maps API enums to Vietnamese labels and tones", () => {
    expect(labelOf(PROJECT_STATUS, "delayed")).toBe("Chậm tiến độ");
    expect(toneOf(PROJECT_STATUS, "completed")).toBe("green");
    expect(labelOf(PROJECT_STATUS, "unknown")).toBe("unknown");
  });
});
