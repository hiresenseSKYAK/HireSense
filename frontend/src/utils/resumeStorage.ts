import type { ResumeUploadResponse } from "../api/resume";

const RESUME_STORAGE_KEY = "hiresense_resume_analysis";

export function saveResumeAnalysis(data: ResumeUploadResponse): void {
  localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify({
    ...data,
    saved_at: data.saved_at || new Date().toISOString(),
  }));
}

export function getResumeAnalysis(): ResumeUploadResponse | null {
  const raw = localStorage.getItem(RESUME_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ResumeUploadResponse;
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
