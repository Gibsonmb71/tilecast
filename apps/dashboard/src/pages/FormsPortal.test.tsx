// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import {
  FormsListPage,
  FormPortalDetailPage,
  FormPortalSubmissionPage,
} from "./FormsPortalPage";
import { api } from "../api/client";
import * as authModule from "../auth/AuthProvider";
import type {
  FormDataSource,
  FormRecord,
  FormRecordDetail,
  FormSummary,
  FormWorkflow,
} from "../api/types";

class RequestWithoutSignal extends globalThis.Request {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const rest = { ...init };
    delete (rest as { signal?: unknown }).signal;
    super(input, rest);
  }
}
globalThis.Request = RequestWithoutSignal;

// jsdom does not implement object URLs, which the image field uses for local previews.
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
globalThis.URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockAuth(userId = "u1") {
  vi.spyOn(authModule, "useAuth").mockReturnValue({
    status: {
      authenticated: true,
      user: { id: userId, name: "User", username: "user", role: "viewer" },
      csrfToken: "tok",
    },
    isLoading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof authModule.useAuth>);
}

const workflow: FormWorkflow = {
  states: [
    {
      key: "draft",
      label: "Draft",
      position: 0,
      eligibleForOutput: false,
      initial: true,
      terminal: false,
    },
    {
      key: "submitted",
      label: "Submitted",
      position: 1,
      eligibleForOutput: false,
      initial: false,
      terminal: false,
    },
    {
      key: "changes_requested",
      label: "Changes requested",
      position: 2,
      eligibleForOutput: false,
      initial: false,
      terminal: false,
    },
    {
      key: "approved",
      label: "Approved",
      position: 3,
      eligibleForOutput: true,
      initial: false,
      terminal: false,
    },
    {
      key: "rejected",
      label: "Rejected",
      position: 4,
      eligibleForOutput: false,
      initial: false,
      terminal: true,
    },
  ],
  transitions: [
    {
      from: "draft",
      to: "submitted",
      label: "Submit",
      requiredCapability: "submit",
      position: 0,
    },
    {
      from: "submitted",
      to: "approved",
      label: "Approve",
      requiredCapability: "approve",
      position: 1,
    },
    {
      from: "submitted",
      to: "changes_requested",
      label: "Request changes",
      requiredCapability: "review",
      position: 2,
    },
    {
      from: "changes_requested",
      to: "submitted",
      label: "Resubmit",
      requiredCapability: "submit",
      position: 3,
    },
  ],
};

const schema = {
  title: "Announcement",
  description: "",
  fields: [
    {
      key: "title",
      label: "Title",
      control: "short_text" as const,
      required: true,
    },
  ],
};

function form(
  capabilities: FormDataSource["grantedCapabilities"],
): FormDataSource {
  return {
    id: "f1",
    name: "Staff Announcements",
    description: "By staff.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    draftSchema: schema,
    publishedRevision: {
      id: "r1",
      dataSourceId: "f1",
      revisionNumber: 1,
      title: "Announcement",
      description: "",
      schema,
      publishedAt: "2026-01-01T00:00:00Z",
    },
    workflow,
    views: [],
    grantedCapabilities: capabilities,
  };
}

function record(overrides: Partial<FormRecord> = {}): FormRecord {
  return {
    id: "rec1",
    dataSourceId: "f1",
    revisionId: "r1",
    state: "draft",
    values: { title: "Hello" },
    submittedBy: "u1",
    submitterName: "User",
    displayTitle: "Hello",
    priority: 0,
    eligible: false,
    version: 1,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function detail(overrides: Partial<FormRecordDetail> = {}): FormRecordDetail {
  return {
    ...record(),
    revision: {
      id: "r1",
      dataSourceId: "f1",
      revisionNumber: 1,
      title: "Announcement",
      description: "",
      schema,
      publishedAt: "2026-01-01T00:00:00Z",
    },
    events: [],
    comments: [],
    attachments: [],
    canEdit: true,
    canComment: true,
    canDelete: false,
    availableTransitions: [
      {
        to: "submitted",
        toLabel: "Submitted",
        label: "Submit",
        requiredCapability: "submit",
        requiresNote: false,
      },
    ],
    ...overrides,
  };
}

function renderPortal(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/forms", element: <FormsListPage /> },
      { path: "/forms/:id", element: <FormPortalDetailPage /> },
      { path: "/forms/:id/new", element: <FormPortalSubmissionPage /> },
      {
        path: "/forms/:id/submissions/:recordId",
        element: <FormPortalSubmissionPage />,
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("Forms portal", () => {
  it("lists accessible forms with submission counts", async () => {
    mockAuth();
    const summary: FormSummary = {
      id: "f1",
      name: "Staff Announcements",
      description: "By staff.",
      publishedRevisionNumber: 1,
      grantedCapabilities: ["submit"],
      submissionCounts: {
        draft: 2,
        submitted: 1,
        changesRequested: 3,
        total: 6,
      },
    };
    vi.spyOn(api, "listForms").mockResolvedValue([summary]);
    renderPortal("/forms");

    expect(
      await screen.findByRole("heading", { name: "My Forms" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Staff Announcements")).toBeInTheDocument();
    // The three counts are surfaced.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("blocks submit until required fields are complete", async () => {
    mockAuth();
    vi.spyOn(api, "getForm").mockResolvedValue(form(["submit"]));
    const create = vi.spyOn(api, "createFormRecord");
    const user = userEvent.setup();
    renderPortal("/forms/f1/new");

    await screen.findByLabelText(/Title/);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a draft and submits via the server-provided transition", async () => {
    mockAuth();
    vi.spyOn(api, "getForm").mockResolvedValue(form(["submit"]));
    // The detail page the editor returns to after completion.
    vi.spyOn(api, "listFormRecords").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    const create = vi
      .spyOn(api, "createFormRecord")
      .mockResolvedValue(record({ id: "rec9", version: 1, state: "draft" }));
    const transition = vi
      .spyOn(api, "transitionFormRecord")
      .mockResolvedValue(
        record({ id: "rec9", version: 2, state: "submitted" }),
      );
    const user = userEvent.setup();
    renderPortal("/forms/f1/new");

    await user.type(await screen.findByLabelText(/Title/), "Big news");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1].values).toMatchObject({
      title: "Big news",
    });
    await waitFor(() => expect(transition).toHaveBeenCalled());
    expect(transition.mock.calls[0]![2]).toMatchObject({
      toState: "submitted",
      version: 1,
    });
  });

  it("shows the reviewer note and resubmits a changes-requested submission", async () => {
    mockAuth();
    vi.spyOn(api, "getForm").mockResolvedValue(form(["submit"]));
    vi.spyOn(api, "getFormRecord").mockResolvedValue(
      detail({
        state: "changes_requested",
        comments: [
          {
            id: "c1",
            authorName: "Reviewer",
            body: "Please add a date",
            createdAt: "2026-01-03T00:00:00Z",
          },
        ],
        availableTransitions: [
          {
            to: "submitted",
            toLabel: "Submitted",
            label: "Resubmit",
            requiredCapability: "submit",
            requiresNote: false,
          },
        ],
      }),
    );
    const update = vi
      .spyOn(api, "updateFormRecord")
      .mockResolvedValue(record({ state: "changes_requested", version: 2 }));
    const transition = vi
      .spyOn(api, "transitionFormRecord")
      .mockResolvedValue(record({ state: "submitted", version: 3 }));
    const user = userEvent.setup();
    renderPortal("/forms/f1/submissions/rec1");

    // The latest reviewer note is shown prominently and in the comment thread.
    expect(
      (await screen.findAllByText("Please add a date")).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Resubmit" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() => expect(transition).toHaveBeenCalled());
    expect(transition.mock.calls[0]![2]).toMatchObject({
      toState: "submitted",
    });
  });

  it("uploads a selected image after creating the draft", async () => {
    mockAuth();
    const imageForm = form(["submit"]);
    const withImage = {
      ...schema,
      fields: [
        ...schema.fields,
        { key: "photo", label: "Photo", control: "image" as const },
      ],
    };
    imageForm.publishedRevision = {
      ...imageForm.publishedRevision!,
      schema: withImage,
    };
    vi.spyOn(api, "getForm").mockResolvedValue(imageForm);
    vi.spyOn(api, "listFormRecords").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(api, "createFormRecord").mockResolvedValue(
      record({ id: "rec9", version: 1 }),
    );
    const upload = vi
      .spyOn(api, "uploadFormRecordAttachment")
      .mockResolvedValue(
        detail({
          id: "rec9",
          version: 2,
          values: { title: "Hi", photo: "asset-1" },
        }),
      );
    const user = userEvent.setup();
    renderPortal("/forms/f1/new");

    await user.type(await screen.findByLabelText(/Title/), "Hi");
    const file = new File([new Uint8Array([1, 2, 3])], "p.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("Choose Photo"), file);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0]![3]).toBe("photo");
  });
});
