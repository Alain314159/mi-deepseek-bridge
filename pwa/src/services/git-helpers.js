import { execCommand } from './nodepod-boot.js';
const GIT_ENV = 'GIT_EDITOR=true GIT_TERMINAL_PROMPT=0';
export const gitInit = (cwd) => execCommand(`cd ${cwd} && git init`, { cwd });
export const gitConfig = (cwd, name, email) =>
  execCommand(`cd ${cwd} && git config user.name "${name}" && git config user.email "${email}"`, { cwd });
export const gitAdd = (cwd, path = '.') => execCommand(`cd ${cwd} && git add ${path}`, { cwd });
export const gitCommit = (cwd, message) => {
  const safeMsg = String(message).replace(/"/g, '\\"');
  return execCommand(`cd ${cwd} && ${GIT_ENV} git commit -m "${safeMsg}" < /dev/null`, { cwd });
};
export const gitLog = (cwd, n = 20) => execCommand(`cd ${cwd} && git log --oneline -n ${n}`, { cwd });
export const gitStatus = (cwd) => execCommand(`cd ${cwd} && git status --short --branch`, { cwd });
export const gitDiff = (cwd) => execCommand(`cd ${cwd} && git diff`, { cwd });
