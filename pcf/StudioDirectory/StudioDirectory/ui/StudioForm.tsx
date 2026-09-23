import * as React from "react";
import { StudioRow } from "../core/types";
import { Banner, Button, Field, Modal } from "./components";

export interface StudioFormValues {
    studioId: string;
    namaStudio: string;
    kapasitasHost: number;
    lokasiStudio: string;
    status: string;
}

export function StudioForm(props: {
    mode: "create" | "edit";
    studio?: StudioRow;
    existingIds: string[];
    statusOptions: string[];
    saving: boolean;
    error?: string;
    onCancel: () => void;
    onSubmit: (v: StudioFormValues) => void;
}): React.ReactElement {
    const s = props.studio;
    const [studioId, setStudioId] = React.useState(s?.studioId ?? "");
    const [nama, setNama] = React.useState(s?.namaStudio ?? "");
    const [kap, setKap] = React.useState(s && s.kapasitasHost > 0 ? String(s.kapasitasHost) : "");
    const [lokasi, setLokasi] = React.useState(s?.lokasiStudio ?? "");
    const [status, setStatus] = React.useState(s?.status || props.statusOptions[0] || "Active");
    const [touched, setTouched] = React.useState(false);

    const idTaken = props.mode === "create" && props.existingIds.some((x) => x.toLowerCase() === studioId.trim().toLowerCase());
    const kapNum = Number(kap);
    const errors = {
        studioId: !studioId.trim() ? "StudioID wajib diisi." : idTaken ? "StudioID ini sudah dipakai studio lain." : "",
        nama: !nama.trim() ? "Nama studio wajib diisi." : "",
        kap: !kap.trim() || !Number.isInteger(kapNum) || kapNum < 1 ? "Kapasitas minimal 1 host." : "",
    };
    const valid = !errors.studioId && !errors.nama && !errors.kap;

    const submit = (): void => {
        setTouched(true);
        if (!valid || props.saving) return;
        props.onSubmit({ studioId: studioId.trim(), namaStudio: nama.trim(), kapasitasHost: kapNum, lokasiStudio: lokasi.trim(), status });
    };

    return (
        <Modal
            title={props.mode === "create" ? "Tambah studio" : `Ubah studio ${s?.studioId ?? ""}`}
            onClose={props.saving ? () => undefined : props.onCancel}
            footer={
                <>
                    <Button variant="ghost" onClick={props.onCancel} disabled={props.saving}>
                        Batal
                    </Button>
                    <Button variant="primary" onClick={submit} disabled={props.saving || (touched && !valid)}>
                        {props.saving ? "Menyimpan…" : props.mode === "create" ? "Tambah studio" : "Simpan perubahan"}
                    </Button>
                </>
            }
        >
            {props.error && <Banner tone="danger">{props.error}</Banner>}
            <div className="sd-formgrid">
                <Field label="StudioID" hint={touched ? errors.studioId || (props.mode === "edit" ? "StudioID tidak bisa diubah karena dirujuk oleh jadwal." : undefined) : props.mode === "edit" ? "StudioID tidak bisa diubah karena dirujuk oleh jadwal." : "Contoh: CWG-05. Dipakai sebagai StudioID di jadwal."} hintTone={touched && errors.studioId ? "danger" : undefined}>
                    <input className="sd-input sd-mono" value={studioId} onChange={(e) => setStudioId(e.target.value.toUpperCase())} disabled={props.mode === "edit"} autoFocus={props.mode === "create"} />
                </Field>
                <Field label="Nama studio" hint={touched ? errors.nama : undefined} hintTone="danger">
                    <input className="sd-input" value={nama} onChange={(e) => setNama(e.target.value)} autoFocus={props.mode === "edit"} />
                </Field>
                <Field label="Kapasitas host" hint={touched && errors.kap ? errors.kap : "Jumlah host yang bisa live bersamaan. Dipakai untuk menghitung utilisasi."} hintTone={touched && errors.kap ? "danger" : undefined}>
                    <input className="sd-input" inputMode="numeric" value={kap} onChange={(e) => setKap(e.target.value.replace(/[^\d]/g, ""))} />
                </Field>
                <Field label="Status">
                    <select className="sd-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                        {props.statusOptions.map((o) => (
                            <option key={o} value={o}>
                                {o}
                            </option>
                        ))}
                    </select>
                </Field>
                <div className="sd-formgrid__full">
                    <Field label="Lokasi" hint="Alamat teks. Titik clock in diatur terpisah di tab Geofence.">
                        <textarea className="sd-input" rows={2} value={lokasi} onChange={(e) => setLokasi(e.target.value)} />
                    </Field>
                </div>
            </div>
        </Modal>
    );
}
