import { simpleGit, type SimpleGit } from "simple-git";

export interface Version {
  sha: string;
  tag: string;
  description: string;
  createdAt: Date;
}

export interface CommitVersionInput {
  description: string;
  files: string[];
}

export class VersionStore {
  private git: SimpleGit;

  constructor(public readonly repoDir: string) {
    this.git = simpleGit(repoDir);
  }

  async commitVersion(input: CommitVersionInput): Promise<Version> {
    await this.git.add(input.files);
    await this.git.commit(input.description);
    const log = await this.git.log({ maxCount: 1 });
    const head = log.latest!;
    const tag = await this.nextTag();
    await this.git.addAnnotatedTag(tag, input.description);
    return {
      sha: head.hash,
      tag,
      description: input.description,
      createdAt: new Date(head.date),
    };
  }

  async list(): Promise<Version[]> {
    const tagsRaw = await this.git.tags();
    const tags = tagsRaw.all.filter(t => /^v\d+$/.test(t));
    const versions: Version[] = [];
    for (const tag of tags) {
      const show = await this.git.raw([
        "log", "-1", "--format=%H%n%aI%n%B", tag,
      ]);
      const [sha, iso, ...rest] = show.split("\n");
      versions.push({
        sha: sha!,
        tag,
        description: rest.join("\n").trim(),
        createdAt: new Date(iso!),
      });
    }
    versions.sort((a, b) => {
      const an = parseInt(a.tag.slice(1), 10);
      const bn = parseInt(b.tag.slice(1), 10);
      return bn - an;
    });
    return versions;
  }

  async checkoutVersion(tag: string): Promise<void> {
    await this.git.raw(["checkout", tag, "--", "."]);
  }

  private async nextTag(): Promise<string> {
    const tagsRaw = await this.git.tags();
    const nums = tagsRaw.all
      .filter(t => /^v\d+$/.test(t))
      .map(t => parseInt(t.slice(1), 10));
    const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
    return `v${next}`;
  }
}
