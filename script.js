(function() {
    'use strict';
    console.log("Asisten v20 (Full Automation) siap dijalankan...");

    if (document.getElementById('asisten-validasi-btn')) {
        document.getElementById('asisten-validasi-btn').remove();
    }

    // --- Definisi Variabel & Fungsi ---
    const SELECTOR_LIST_UTAMA_MATKUL = "div.messageListMakulBelum ul > li";
    const SELECTOR_DROPDOWN_MATKUL = "#makul";
    const SELECTOR_TOMBOL_VALIDASI_BIRU = "table.table-bordered a.btn-sm.btn-primary";
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Fungsi untuk mengisi form validasi otomatis (termasuk asisten dosen)
    async function isiFormValidasi() {
        console.log("Memulai pengisian form validasi...");
        
        // Tunggu 1 detik untuk memastikan modal sepenuhnya terbuka
        await sleep(1000);
        
        // 1. Validasi untuk DOSEN
        // Pilih opsi "Benar" untuk pertanyaan pertama
        const radioBenar = document.querySelector('input[name="kesesuaian_perkuliahan"][value="1"]');
        if (radioBenar) {
            radioBenar.checked = true;
            radioBenar.dispatchEvent(new Event('change', { bubbles: true }));
            console.log("Memilih 'Benar' untuk kehadiran dosen");
        }

        // Pilih opsi "Ya sesuai" untuk pertanyaan kedua
        const radioYaSesuai = document.querySelector('input[name="kesesuaian_materi"][value="1"]');
        if (radioYaSesuai) {
            radioYaSesuai.checked = true;
            radioYaSesuai.dispatchEvent(new Event('change', { bubbles: true }));
            console.log("Memilih 'Ya sesuai' untuk kesesuaian materi");
        }

        // Pilih opsi "Baik" untuk pertanyaan ketiga
        const radioBaik = document.querySelector('input[name="penilaianmhs"][value="3"]');
        if (radioBaik) {
            radioBaik.checked = true;
            radioBaik.dispatchEvent(new Event('change', { bubbles: true }));
            console.log("Memilih 'Baik' untuk penilaian dosen");
        }

        // 2. Validasi untuk ASISTEN DOSEN
        console.log("Memproses validasi asisten dosen...");
        
        // Kumpulkan semua radio button asdos
        const semuaRadioAsdos = document.querySelectorAll('input[name^="asdospenilaian_"]');
        
        if (semuaRadioAsdos.length > 0) {
            // Dapatkan indeks asdos unik (0, 1, dst)
            const indeksAsdos = [...new Set(
                [...semuaRadioAsdos].map(radio => radio.name.split('_')[1])
            )];

            // Untuk setiap asdos, isi ke-4 pertanyaan
            for (const indeks of indeksAsdos) {
                console.log(`Memproses asdos indeks ${indeks}...`);
                
                // Pertanyaan 1: Selalu Tepat Waktu (value=1)
                const radioTepatWaktu = document.querySelector(
                    `input[name="asdospenilaian_${indeks}_1"][value="1"]`
                );
                if (radioTepatWaktu) {
                    radioTepatWaktu.checked = true;
                    radioTepatWaktu.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Pertanyaan 2: Selalu sesuai (value=5)
                const radioSesuai = document.querySelector(
                    `input[name="asdospenilaian_${indeks}_2"][value="5"]`
                );
                if (radioSesuai) {
                    radioSesuai.checked = true;
                    radioSesuai.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Pertanyaan 3: Baik (value=10)
                const radioBaikAsdos = document.querySelector(
                    `input[name="asdospenilaian_${indeks}_3"][value="10"]`
                );
                if (radioBaikAsdos) {
                    radioBaikAsdos.checked = true;
                    radioBaikAsdos.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Pertanyaan 4: Baik (value=14)
                const radioSangatBaik = document.querySelector(
                    `input[name="asdospenilaian_${indeks}_4"][value="14"]`
                );
                if (radioSangatBaik) {
                    radioSangatBaik.checked = true;
                    radioSangatBaik.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            console.log(`Berhasil memvalidasi ${indeksAsdos.length} asisten dosen`);
        } else {
            console.log("Tidak ditemukan asisten dosen");
        }

        // 3. Klik tombol Simpan
        const btnSimpan = document.getElementById('btnsimpan');
        if (btnSimpan) {
            console.log("Mengklik tombol Simpan...");
            btnSimpan.click();
            
            // Tunggu 2 detik untuk memastikan data tersimpan
            await sleep(2000);
        }
    }

    // Fungsi untuk mengklik tombol 'B' satu per satu dan mengisi form
    async function prosesSesiSatuPerSatu() {
        while (true) {
            const tombolBiru = document.querySelector(SELECTOR_TOMBOL_VALIDASI_BIRU);
            if (!tombolBiru) {
                console.log("✅ Semua sesi untuk mata kuliah ini selesai.");
                return true; // Mengembalikan true untuk menandakan selesai
            }
            
            console.log("Menemukan sesi... Mensimulasikan klik pada tombol 'B'...");
            
            // Simpan fungsi asli onclick jika ada
            const originalOnClick = tombolBiru.onclick;
            let modalDibuka = false;
            
            // Override fungsi onclick untuk mendeteksi pembukaan modal
            tombolBiru.onclick = function(e) {
                // Panggil fungsi asli jika ada
                if (originalOnClick) {
                    originalOnClick.call(this, e);
                }
                
                // Tandai bahwa modal sedang dibuka
                modalDibuka = true;
            };
            
            // Klik tombol
            tombolBiru.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
            );
            
            // Tunggu hingga modal terbuka (dicek setiap 200ms)
            for (let i = 0; i < 15; i++) {
                if (modalDibuka) break;
                await sleep(200);
            }
            
            if (modalDibuka) {
                console.log("Modal validasi terbuka, mengisi form...");
                await isiFormValidasi();
            } else {
                console.warn("Modal tidak terbuka setelah klik tombol, melanjutkan...");
            }
            
            // Kembalikan fungsi onclick asli
            tombolBiru.onclick = originalOnClick;
            
            // Tunggu sebelum melanjutkan ke sesi berikutnya
            await sleep(1500);
        }
    }

    // Fungsi utama yang menjalankan seluruh alur kerja
    async function mulaiValidasiUtama() {
        console.log("Memulai proses validasi otomatis penuh...");
        const tombolAsisten = document.getElementById('asisten-validasi-btn');
        tombolAsisten.innerHTML = '⚙️ Sedang Bekerja...';
        tombolAsisten.disabled = true;

        while (true) {
            const daftarMatkulUtama = document.querySelectorAll(SELECTOR_LIST_UTAMA_MATKUL);
            if (daftarMatkulUtama.length === 0) {
                alert("🎉 SEMUA VALIDASI TELAH SELESAI!");
                tombolAsisten.innerHTML = '✔️ Semua Selesai';
                break;
            }

            const namaMatkul = daftarMatkulUtama[0].textContent.split("Mata Kuliah ")[1].trim();
            console.log(`--- Memproses Mata Kuliah: ${namaMatkul} ---`);
            const dropdown = document.querySelector(SELECTOR_DROPDOWN_MATKUL);
            const options = Array.from(dropdown.options);
            const targetOption = options.find(opt => opt.text.trim() === namaMatkul);

            if (targetOption) {
                // --- Simulasi lengkap untuk dropdown ---
                console.log("Memilih matkul di dropdown...");
                
                // 1. Focus pada dropdown
                dropdown.focus();
                dropdown.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
                await sleep(300);
                
                // 2. Buka dropdown
                dropdown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                await sleep(500);
                
                // 3. Pilih opsi
                targetOption.selected = true;
                
                // 4. Trigger semua event yang diperlukan
                targetOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                dropdown.dispatchEvent(new Event('input', { bubbles: true }));
                dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                
                // 5. Tutup dropdown (simulasi keydown ESC)
                dropdown.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true
                }));
                
                console.log(`Berhasil memilih ${namaMatkul}. Menunggu daftar sesi muncul...`);
                await sleep(3000);

                // Proses semua tombol 'B' di matkul ini
                const selesai = await prosesSesiSatuPerSatu();
                
                if (selesai) {
                    console.log(`--- Selesai dengan Mata Kuliah: ${namaMatkul} ---`);
                    
                    // Refresh halaman untuk memuat data terbaru
                    console.log("Me-refresh halaman untuk matkul berikutnya...");
                    window.location.reload();
                    return; // Keluar dari loop karena halaman akan refresh
                }
            } else {
                console.error(`Gagal menemukan ${namaMatkul} di dropdown.`);
                tombolAsisten.innerHTML = '❌ Gagal';
                break;
            }
        }
    }

    // Membuat tombol utama
    const btn = document.createElement('button');
    btn.id = 'asisten-validasi-btn';
    btn.innerHTML = '🚀 Jalankan Validasi TOTAL';
    btn.style = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 20px; background-color: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.2); font-size: 16px; font-weight: bold;';
    document.body.appendChild(btn);
    btn.addEventListener('click', mulaiValidasiUtama);

    console.log("Tombol 'Jalankan Validasi TOTAL' telah ditambahkan");
})();