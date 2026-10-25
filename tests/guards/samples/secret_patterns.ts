const ant = "sk-" + "ant-";
const lin = "lin_" + "api_";
const gh = "gh[pousr]" + "_";
const pat = "github_" + "pat_";
const key = "PRIVATE " + "KEY";

export const violation = {
  "mini/bin/shot": `#!/bin/zsh\ngrep -qE '${ant}|${gh}x'\ncase $k in ${lin}*) ;; esac\n`,
  "ctl/mini-x": `#!/bin/zsh\nsed -E 's/(ghs_|${pat})x//'\n`,
  ".github/image-check": `#!/usr/bin/env bash\nRES=('-----BEGIN ${key}')\n`,
  "host/Dockerfile": `RUN grep -v ghp_x /x\n`,
};

export const clean = {
  "mini/lib/secrets.zsh": `SECRET_RES=('${ant}x' '${lin}x' '${gh}x' '${pat}x' '${key}')\n`,
  "mini/bin/shot": "#!/bin/zsh\nsource ${0:A:h}/../lib/secrets.zsh\nsecrets_found linear\n",
  "README.md": `Hides \`${ant}\` and \`${lin}\` tokens.\n`,
  "tests/mini/bin/shot.test.ts": `const token = "${lin}abc";\n`,
  "ctl/mini-y": "#!/bin/zsh\nsigh_x=1; high_score=2\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
const at = (where: string, literal: string) =>
  `${where}: holds secret pattern ${literal}; use mini/lib/secrets.zsh`;
export const expected = [
  at("mini/bin/shot:2", ant),
  at("mini/bin/shot:2", gh),
  at("mini/bin/shot:3", lin),
  at("ctl/mini-x:2", "ghs_"),
  at("ctl/mini-x:2", pat),
  at(".github/image-check:2", key),
  at("host/Dockerfile:1", "ghp_"),
];
