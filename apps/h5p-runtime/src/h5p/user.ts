import {
  ContentPermission,
  GeneralPermission,
  IPermissionSystem,
  IUser,
  TemporaryFilePermission,
  UserDataPermission
} from '@lumieducation/h5p-server';

/**
 * IUser in v10 is only { id, name, email, type } — all authorization moved to
 * IPermissionSystem. `role` is our own addition, carried on the user object and
 * read by SpikePermissionSystem below.
 */
export class SpikeUser implements IUser {
  public type = 'local';

  constructor(
    public id: string,
    public name: string,
    public email: string,
    public role: 'author' | 'learner'
  ) {}
}

/** Fixed spike identities. Real authentication is explicitly out of scope. */
export const AUTHOR_USER = new SpikeUser(
  'spike-author',
  'Spike Author',
  'author@example.invalid',
  'author'
);
export const LEARNER_USER = new SpikeUser(
  'spike-learner',
  'Spike Learner',
  'learner@example.invalid',
  'learner'
);

/**
 * Deliberately NOT LaissezFairePermissionSystem.
 *
 * Lumi's default permission system returns true for every check, which means an
 * unauthenticated editor endpoint lets anyone install libraries — i.e. run
 * arbitrary JS in every other user's browser. The spike wires a real (if tiny)
 * permission system so that risk is demonstrated as a configuration choice
 * rather than left implicit.
 */
/** Narrowing helper: Lumi hands us an IUser, which need not carry our role. */
function roleOf(user: IUser | undefined): 'author' | 'learner' | null {
  const role = (user as Partial<SpikeUser> | undefined)?.role;
  return role === 'author' || role === 'learner' ? role : null;
}

export class SpikePermissionSystem implements IPermissionSystem {
  public async checkForContent(
    actingUser: IUser | undefined,
    permission: ContentPermission
  ): Promise<boolean> {
    const role = roleOf(actingUser);
    if (!role) return false;
    if (role === 'author') return true;
    // Learners may only consume content.
    return [
      ContentPermission.View,
      ContentPermission.List,
      ContentPermission.Embed
    ].includes(permission);
  }

  public async checkForUserData(
    actingUser: IUser | undefined,
    permission: UserDataPermission,
    _contentId: string,
    affectedUserId?: string
  ): Promise<boolean> {
    if (!actingUser) return false;
    // A user may only ever touch their own state/completion data. Without this,
    // the contentUserData endpoints let one learner read or overwrite another's
    // progress by changing a query parameter.
    if (affectedUserId !== undefined && affectedUserId !== actingUser.id) {
      return false;
    }
    return [
      UserDataPermission.EditState,
      UserDataPermission.ViewState,
      UserDataPermission.DeleteState,
      UserDataPermission.ListStates,
      UserDataPermission.EditFinished,
      UserDataPermission.ViewFinished
    ].includes(permission);
  }

  public async checkForTemporaryFile(
    actingUser: IUser | undefined,
    _permission: TemporaryFilePermission
  ): Promise<boolean> {
    // Only authors upload media.
    return roleOf(actingUser) === 'author';
  }

  public async checkForGeneralAction(
    actingUser: IUser | undefined,
    permission: GeneralPermission
  ): Promise<boolean> {
    if (roleOf(actingUser) !== 'author') return false;
    // Installing a library means shipping third-party JS to every learner. The
    // spike grants it to authors only, and only because importing legacy
    // packages requires it.
    return [
      GeneralPermission.UpdateAndInstallLibraries,
      GeneralPermission.InstallRecommended,
      GeneralPermission.CreateRestricted
    ].includes(permission);
  }
}
