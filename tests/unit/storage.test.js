import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorage, setStorageAdapter, getProfile, saveProfile, getApplications, addApplication, updateApplication, deleteApplication, } from "../../src/shared/storage";
import { EMPTY_PROFILE } from "../../src/shared/types";
beforeEach(() => {
    setStorageAdapter(createMemoryStorage());
});
describe("Profile storage", () => {
    it("returns empty profile when none saved", async () => {
        const profile = await getProfile();
        expect(profile).toEqual(EMPTY_PROFILE);
    });
    it("saves and retrieves profile", async () => {
        const profile = {
            ...EMPTY_PROFILE,
            firstName: "Connor",
            lastName: "Smith",
            email: "connor@example.com",
        };
        await saveProfile(profile);
        const retrieved = await getProfile();
        expect(retrieved.firstName).toBe("Connor");
        expect(retrieved.email).toBe("connor@example.com");
    });
});
describe("Application storage", () => {
    const testApp = {
        id: "test-1",
        company: "Acme Inc",
        role: "Software Engineer",
        url: "https://example.com/apply",
        status: "saved",
        dateAdded: new Date().toISOString(),
        dateApplied: "",
        notes: "",
        salary: "",
        location: "",
    };
    it("returns empty array when no apps saved", async () => {
        const apps = await getApplications();
        expect(apps).toEqual([]);
    });
    it("adds an application", async () => {
        await addApplication(testApp);
        const apps = await getApplications();
        expect(apps).toHaveLength(1);
        expect(apps[0].company).toBe("Acme Inc");
    });
    it("updates application status", async () => {
        await addApplication(testApp);
        await updateApplication("test-1", { status: "applied" });
        const apps = await getApplications();
        expect(apps[0].status).toBe("applied");
    });
    it("deletes an application", async () => {
        await addApplication(testApp);
        await addApplication({ ...testApp, id: "test-2", company: "Beta Corp" });
        await deleteApplication("test-1");
        const apps = await getApplications();
        expect(apps).toHaveLength(1);
        expect(apps[0].company).toBe("Beta Corp");
    });
    it("handles update for non-existent ID gracefully", async () => {
        await addApplication(testApp);
        await updateApplication("nonexistent", { status: "applied" });
        const apps = await getApplications();
        expect(apps[0].status).toBe("saved"); // unchanged
    });
});
