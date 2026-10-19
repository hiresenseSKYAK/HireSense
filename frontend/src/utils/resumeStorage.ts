import type { ResumeUploadResponse } from "../api/resume";
import { getAuthSession } from "../api/auth";

const RESUME_STORAGE_KEY = "hiresense_resume_analysis";

export function saveResumeAnalysis(data: ResumeUploadResponse): void {
  localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify({
    ...data,
    saved_at: data.saved_at || new Date().toISOString(),
    owner_user_id: getAuthSession()?.user.id ?? null,
  }));
}

export function getResumeAnalysis(): ResumeUploadResponse | null {
  const raw = localStorage.getItem(RESUME_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const saved = JSON.parse(raw) as ResumeUploadResponse & { owner_user_id?: number | null };
    const userId = getAuthSession()?.user.id;
    if (saved.owner_user_id && saved.owner_user_id !== userId) return null;
    if (userId && !saved.owner_user_id) {
      saved.owner_user_id = userId;
      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(saved));
    }
    return saved;
  } catch (error) {
    console.error("Failed to parse saved resume analysis:", error);
    localStorage.removeItem(RESUME_STORAGE_KEY);
    return null;
  }
}

export function clearResumeAnalysis(): void {
  localStorage.removeItem(RESUME_STORAGE_KEY);
}

export function hasResumeAnalysis(): boolean {
  return getResumeAnalysis() !== null;
}
