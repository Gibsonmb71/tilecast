// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { FormSchema } from "../api/types";
import { FormRenderer } from "./FormRenderer";

afterEach(cleanup);

const schema: FormSchema = {
  title: "Staff Announcement",
  description: "Tell us what to post.",
  fields: [
    { key: "title", label: "Title", control: "short_text", required: true },
    { key: "body", label: "Body", control: "long_text" },
    { key: "intro", label: "Section heading", control: "section" },
    {
      key: "tip",
      label: "Tip",
      control: "help_text",
      description: "Be concise.",
    },
    { key: "photo", label: "Photo", control: "image" },
  ],
};

describe("FormRenderer", () => {
  it("renders title, description, and fields with required markers", () => {
    render(<FormRenderer schema={schema} readOnly />);
    expect(screen.getByText("Staff Announcement")).toBeInTheDocument();
    expect(screen.getByText("Tell us what to post.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    // Section renders as a heading, not an input.
    expect(
      screen.getByRole("heading", { name: "Section heading" }),
    ).toBeInTheDocument();
    // Help text renders as presentation text.
    expect(screen.getByText("Be concise.")).toBeInTheDocument();
    // Image renders a disabled file picker in preview.
    expect(screen.getByLabelText(/Photo/)).toBeDisabled();
  });

  it("disables inputs in read-only mode", () => {
    render(<FormRenderer schema={schema} readOnly />);
    expect(screen.getByLabelText(/Title/)).toBeDisabled();
  });
});
