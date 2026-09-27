type MatchableJob = {
  title?: string
  company?: string
  description?: string | { about?: string }
  fullDescription?: string
  tags?: string[]
  skills?: string[]
}

type ResumeParsedData = {
  skills?: string[]
  summary?: string
}

export type JobMatchResult = {
  matchScore: number
  matchedSkills: string[]
  missingSkills: string[]
  recommendation: string
}

const KNOWN_SKILLS = [
  'python',
  'java',
  'javascript',
  'typescript',
  'react',
  'node',
  'node.js',
  'express',
  'fastapi',
  'flask',
  'django',
  'spring',
  'sql',
  'mysql',
  'postgresql',
  'mongodb',
  'sql server',
  'sqlite',
  'oracle',
  'docker',
  'kubernetes',
  'aws',
  'azure',
  'gcp',
  'git',
  'github',
  'rest',
  'rest api',
  'api',
  'linux',
  'unix',
  'windows',
  'html',
  'css',
  'tailwind',
  'bootstrap',
  'pandas',
  'numpy',
  'tensorflow',
  'pytorch',
  'machine learning',
  'deep learning',
  'data analysis',
  'data analytics',
  'power bi',
  'tableau',
  'excel',
  'c',
  'c++',
  'c#',
  'go',
  'rust',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'scala',
  'bash',
  'shell',
  'ci/cd',
  'azure devops',
  'github actions',
  'jira',
  'agile',
  'scrum',
  'unit testing',
  'pytest',
  'selenium',
  'playwright',
  'cloud',
  'microservices',
  'oop',
  'object oriented programming',
  'data structures',
  'algorithms',
]

const NORMALIZED_DISPLAY_OVERRIDES: Record<string, string> = {
  api: 'API',
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  'ci/cd': 'CI/CD',
  sql: 'SQL',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  sqlite: 'SQLite',
  react: 'React',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  node: 'Node.js',
  'node.js': 'Node.js',
  fastapi: 'FastAPI',
  flask: 'Flask',
  django: 'Django',
  python: 'Python',
  java: 'Java',
  'c++': 'C++',
  'c#': 'C#',
  html: 'HTML',
  css: 'CSS',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  github: 'GitHub',
  linux: 'Linux',
  unix: 'Unix',
  windows: 'Windows',
  pandas: 'Pandas',
  numpy: 'NumPy',
  tensorflow: 'TensorFlow',
  pytorch: 'PyTorch',
  pytest: 'Pytest',
  selenium: 'Selenium',
  playwright: 'Playwright',
  jira: 'Jira',
  agile: 'Agile',
  scrum: 'Scrum',
  excel: 'Excel',
  tableau: 'Tableau',
  'power bi': 'Power BI',
  'sql server': 'SQL Server',
  'azure devops': 'Azure DevOps',
  'github actions': 'GitHub Actions',
  'rest api': 'REST API',
  rest: 'REST',
  oop: 'OOP',
  'object oriented programming': 'Object-Oriented Programming',
  'data structures': 'Data Structures',
  algorithms: 'Algorithms',
  'machine learning': 'Machine Learning',
  'deep learning': 'Deep Learning',
  'data analysis': 'Data Analysis',
  'data analytics': 'Data Analytics',
}

function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

function uniqueNormalized(values: string[] = []): string[] {
  const seen = new Set<string>()

  values.forEach((value) => {
    const normalized = normalizeSkill(value)
    if (normalized) {
      seen.add(normalized)
    }
  })

  return Array.from(seen)
}

function toDisplayCase(skill: string): string {
  const normalized = normalizeSkill(skill)

  if (NORMALIZED_DISPLAY_OVERRIDES[normalized]) {
    return NORMALIZED_DISPLAY_OVERRIDES[normalized]
  }

  return normalized
    .split(' ')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function getJobText(job: MatchableJob | undefined): string {
  if (!job) {
    return ''
  }

  let descriptionText = job.fullDescription || ''
  if (!descriptionText) {
    descriptionText =
      typeof job.description === 'string'
        ? job.description
        : job.description?.about || ''
  }

  return [job.title || '', job.company || '', descriptionText].join(' ').toLowerCase()
}

function extractSkillsFromText(text: string): string[] {
  if (!text.trim()) {
    return []
  }

  const detected = new Set<string>()

  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i')

    if (pattern.test(text)) {
      detected.add(normalizeSkill(skill))
    }
  }

  if (/\bnode\b/i.test(text) || /\bnode\.js\b/i.test(text)) {
    detected.add('node.js')
  }

  if (/\brestful\b/i.test(text)) {
    detected.add('rest api')
  }

  if (/\bms sql\b/i.test(text) || /\bmicrosoft sql server\b/i.test(text)) {
    detected.add('sql server')
  }

  return Array.from(detected)
}

function getJobSkillUniverse(job: MatchableJob | undefined): string[] {
  const directSkills = [...(job?.tags ?? []), ...(job?.skills ?? [])]
  const jobText = getJobText(job)
  const extractedSkills = extractSkillsFromText(jobText)

  return uniqueNormalized([...directSkills, ...extractedSkills])
}

function getResumeSkillUniverse(resumeData: ResumeParsedData | undefined): string[] {
  return uniqueNormalized(resumeData?.skills ?? [])
}

function buildRecommendation(matchScore: number): string {
  if (matchScore >= 85) {
    return 'Strong fit. Your resume aligns very well with this role’s core skills and technologies.'
  }

  if (matchScore >= 70) {
    return 'Good fit. You already match many of the important skills, with a few smaller gaps to close.'
  }

  if (matchScore >= 50) {
    return 'Moderate fit. You have meaningful overlap, but tailoring your resume and strengthening the missing areas would help.'
  }

  if (matchScore >= 30) {
    return 'Partial fit. You match some relevant skills, but this role still has several important gaps.'
  }

  return 'Low fit right now. This posting lists several skills that are not yet reflected strongly in your resume.'
}

export function matchResumeToJob(
  resumeData: ResumeParsedData | undefined,
  job: MatchableJob | undefined
): JobMatchResult {
  const resumeSkills = getResumeSkillUniverse(resumeData)
  const jobSkills = getJobSkillUniverse(job)

  if (jobSkills.length === 0) {
    return {
      matchScore: 0,
      matchedSkills: [],
      missingSkills: [],
      recommendation:
        'No job skills were available for matching yet. Add structured skills to the job data or improve the job parser.',
    }
  }

  const matchedSkills = jobSkills.filter((skill) => resumeSkills.includes(skill))
  const missingSkills = jobSkills.filter((skill) => !resumeSkills.includes(skill))

  const coverage = matchedSkills.length / jobSkills.length
  // Sparse job metadata cannot support high confidence. Require at least four
  // distinct job skills before a complete overlap can reach 100%.
  const evidenceWeight = Math.min(1, jobSkills.length / 4)
  const rawScore = Math.round(coverage * evidenceWeight * 100)

  const matchScore = Math.max(0, Math.min(100, rawScore))

  matchedSkills.sort((a, b) => a.localeCompare(b))
  missingSkills.sort((a, b) => a.localeCompare(b))

  return {
    matchScore,
    matchedSkills: matchedSkills.map(toDisplayCase),
    missingSkills: missingSkills.map(toDisplayCase),
    recommendation: buildRecommendation(matchScore),
  }
}
