import DelegatedEventTarget from "./DelegateEventTarget";

const SUFFIX = "/_matrix/client/r0/";

type TMatrixAccessInfo = {
    access_token: string;
    device_id: string;
    home_server: string;
    user_id: string;
    url: string;
};

type TServiceProps = {
    store?: {accessInfo: TMatrixAccessInfo};
};

type TUser = {
    displayname: string;
    sender: string;
    avatar_url: string;
};

type TStorage = {
    syncs: any;
    user: TUser[];
};

export default class Matrix extends DelegatedEventTarget {
    private accessInfo: TMatrixAccessInfo | null = null;
    private storage: TStorage = {
        syncs: [],
        user: [],
    };
    private syncActive: boolean = false;

    constructor({store}: TServiceProps) {
        super();
        if (store) {
            this.accessInfo = store.accessInfo || null;
        }
    }

    getAccessInfo = () => this.accessInfo;
    getSyncs = () => this.storage.syncs;
    getUsers = () => this.storage.user;

    login = async (username: string, password: string, baseUrl: string) => {
        try {
            const url = new URL(SUFFIX, baseUrl).toString();
            const res = await fetch(new URL("login", url), {
                method: "POST",
                body: JSON.stringify({
                    type: "m.login.password",
                    identifier: {
                        address: username,
                        medium: "email",
                        type: "m.id.thirdparty",
                    },
                    password,
                }),
            });
            if (res.ok) {
                const accessData = await res.json();
                this.accessInfo = {
                    ...accessData,
                    url,
                };
            } else {
                this.accessInfo = null;
            }

            this.save();

            this.dispatchEvent(new Event("LOGIN_SUCCESS"));
            return res.ok;
        } catch (e) {
            console.error(e);
            this.dispatchEvent(new Event("LOGIN_FAILED"));
            return false;
        }
    };

    sync: any = async () => {
        if (this.accessInfo === null || !this.accessInfo?.access_token) return;
        try {
            if (this.syncActive) return;
            this.syncActive = true;
            const lastBatch =
                this.storage.syncs.length > 0
                    ? this.storage.syncs[this.storage.syncs.length - 1]
                          .next_batch
                    : null;

            const res = await fetch(
                new URL(
                    `sync?access_token=${
                        this.accessInfo.access_token
                    }&timeout=30000&${lastBatch ? "&since=" + lastBatch : ""}`,
                    this.accessInfo.url,
                ),
            );
            if (res.ok) {
                const jsonRes = await res.json();
                const found = this.storage.syncs.find(
                    (sync: any) => sync.next_batch === jsonRes.next_batch,
                );
                if (!found) {
                    this.storage.syncs = [...this.storage.syncs, jsonRes];
                }
                // prototype of getting user info
                if (this.storage.syncs.length > 0) {
                    this.storage.syncs.forEach((sync: any) => {
                        Object.keys(sync.rooms.join).forEach((k) => {
                            sync.rooms.join[k].state.events.forEach(
                                (evt: any) => {
                                    if (evt.type === "m.room.member") {
                                        const found = this.storage.user.find(
                                            (u) =>
                                                u.displayname ===
                                                evt.content.displayname,
                                        );
                                        if (!found) {
                                            this.storage.user = [
                                                ...this.storage.user,
                                                {...evt.content},
                                            ];
                                        }
                                    }
                                },
                            );
                        });
                    });
                }

                this.syncActive = false;
                this.dispatchEvent(new Event("SYNC_UPDATE"));
                return this.sync();
            }
        } catch (e) {
            console.error(e);
            this.syncActive = false;
            return false;
        }
    };

    getBackup = async () => {
        if (!this.accessInfo) return;

        const res = await fetch(
            new URL(
                "room_keys/version?access_token=" +
                    this.accessInfo?.access_token,
                this.accessInfo.url,
            ),
        );
        if (res.ok) {
            return await res.json();
        }
        return res.ok;
    };

    private save = () => {
        localStorage.setItem(
            "store",
            JSON.stringify({
                accessInfo: this.accessInfo,
            }),
        );
    };
}
