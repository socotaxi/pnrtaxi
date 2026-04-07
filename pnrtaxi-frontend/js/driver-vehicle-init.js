import { supabase }         from './supabase-config.js';
import { getDriverSession } from './driver-auth.js';

const session = getDriverSession();
if (!session) window.location.replace('driver-auth.html?m=signup');

// Pré-remplir nom & prénom depuis la session
if (session.nom)    document.getElementById('p-nom').value    = session.nom.toUpperCase();
if (session.prenom) document.getElementById('p-prenom').value = session.prenom;

// Pré-remplir la photo de profil depuis la session
if (session.photo) {
  const picker  = document.getElementById('avatar-picker');
  const preview = document.getElementById('avatar-preview');
  preview.innerHTML = `<img src="${session.photo}" alt="avatar" />`;
  picker.classList.add('has-photo');
  picker.querySelector('.avatar-label').textContent = 'Photo sélectionnée ✓';
}

// ══════════════════════════════════════════════════════════════
//  Données marques / modèles
// ══════════════════════════════════════════════════════════════
const BRANDS_CAR = {
  'Toyota'      : ['Corolla','Camry','Yaris','Hilux','Land Cruiser','RAV4','Fortuner','Prado','Avensis','Auris'],
  'Hyundai'     : ['Accent','Elantra','Tucson','Santa Fe','i10','i20','i30','Creta','Sonata'],
  'Kia'         : ['Rio','Picanto','Sportage','Sorento','Cerato','Soul','Stonic'],
  'Renault'     : ['Logan','Sandero','Duster','Symbol','Clio','Megane','Koleos','Kwid'],
  'Peugeot'     : ['206','207','208','301','308','405','406','407','504','508','2008','3008'],
  'Citroën'     : ['C3','C4','C5','Berlingo','Xsara','Saxo'],
  'Nissan'      : ['Micra','Almera','Tiida','Note','Patrol','Navara','X-Trail','Juke'],
  'Mitsubishi'  : ['Colt','Lancer','Pajero','Outlander','L200','Galant','Eclipse Cross'],
  'Honda'       : ['Civic','Accord','Jazz','CR-V','HR-V','City','Fit'],
  'Suzuki'      : ['Swift','Alto','Baleno','Vitara','Ignis','Jimny','Ertiga','Spresso'],
  'Ford'        : ['Focus','Fiesta','Ka','EcoSport','Ranger','Transit','Mondeo'],
  'Volkswagen'  : ['Polo','Golf','Passat','Tiguan','Jetta','Touareg'],
  'Mercedes'    : ['Classe A','Classe C','Classe E','Classe S','GLA','GLC','Vito','Sprinter'],
  'BMW'         : ['Série 1','Série 3','Série 5','X1','X3','X5'],
  'Datsun'      : ['Go','Go+','Redi-GO'],
  'Fiat'        : ['Punto','Palio','Siena','Bravo','500','Tipo'],
  'Opel'        : ['Corsa','Astra','Insignia','Mokka','Zafira'],
  'Isuzu'       : ['D-Max','MU-X','Trooper'],
  'Chery'       : ['QQ','Arrizo 3','Arrizo 5','Tiggo 2','Tiggo 4','Tiggo 7'],
  'BYD'         : ['F0','F3','F6','S6','Tang','Han'],
  'Autre'       : ['Autre modèle'],
};

const BRANDS_MOTO = {
  'Honda'       : ['CB125','CB150','CG125','CRF150','PCX125','Wave 110','Shine','XR150'],
  'Yamaha'      : ['FZ-S','R15','MT-15','NMAX','Aerox','Crypton','YBR125','Saluto'],
  'Suzuki'      : ['GS150','GD110','Gixxer','Hayate','Access 125','Burgman'],
  'Bajaj'       : ['Boxer 100','Discover 100','Discover 125','Platina','Pulsar 135','Pulsar 150'],
  'TVS'         : ['Apache RTR 150','Apache RTR 160','Star City','Star Sport','Radeon'],
  'Lifan'       : ['LF150','LF200','KPR 150','KPT 200'],
  'Jialing'     : ['JH70','JH110','JH125'],
  'Kymco'       : ['Agility 125','Like 150','Downtown 300'],
  'SYM'         : ['Orbit 125','Jet 14','Symphony 125'],
  'Haojue'      : ['DR160','HJ125-8','Uoo 125'],
  'Dayun'       : ['DY110','DY125','DY150'],
  'Loncin'      : ['LX150','LX125','GP150'],
  'Autre'       : ['Autre modèle'],
};

// ══════════════════════════════════════════════════════════════
//  Navigation
// ══════════════════════════════════════════════════════════════
function goTo(id) {
  document.querySelectorAll('.vehicle-screen').forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() => document.getElementById(id).classList.add('active'));
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ══════════════════════════════════════════════════════════════
//  ÉCRAN 1 — Type de véhicule
// ══════════════════════════════════════════════════════════════
let selectedType      = null;
let selectedCondition = null;

const btnCar  = document.getElementById('btn-type-car');
const btnMoto = document.getElementById('btn-type-moto');
const btnNext = document.getElementById('btn-next-type');

function populateBrands(type) {
  const brands  = type === 'car' ? BRANDS_CAR : BRANDS_MOTO;
  const marqSel = document.getElementById('v-marque');
  marqSel.innerHTML = '<option value="">— Sélectionner —</option>';
  Object.keys(brands).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    marqSel.appendChild(opt);
  });
  document.getElementById('v-modele').innerHTML = '<option value="">— Choisir d\'abord une marque —</option>';
  document.getElementById('v-modele').disabled  = true;
}

function selectType(type) {
  selectedType = type;
  btnCar.classList.toggle('selected',  type === 'car');
  btnMoto.classList.toggle('selected', type === 'moto');
  btnNext.disabled = false;

  document.getElementById('details-icon').textContent  = type === 'car' ? '🚗' : '🏍️';
  document.getElementById('details-title').textContent = type === 'car' ? 'Détails de votre voiture' : 'Détails de votre moto';
  document.getElementById('field-cylindree').style.display = type === 'moto' ? '' : 'none';
  populateBrands(type);
}

btnCar.addEventListener('click',  () => selectType('car'));
btnMoto.addEventListener('click', () => selectType('moto'));
btnNext.addEventListener('click', () => {
  if (!selectedType) return;
  goTo('screen-details');
  checkDetailsReady();
});

// ══════════════════════════════════════════════════════════════
//  ÉCRAN 2 — Détails du véhicule
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-back-type').addEventListener('click', () => goTo('screen-type'));

// Marque → Modèle dynamique
document.getElementById('v-marque').addEventListener('change', function () {
  const brands   = selectedType === 'car' ? BRANDS_CAR : BRANDS_MOTO;
  const models   = brands[this.value] || [];
  const modelSel = document.getElementById('v-modele');
  modelSel.innerHTML = '<option value="">— Sélectionner —</option>';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    modelSel.appendChild(opt);
  });
  modelSel.disabled = models.length === 0;
  checkDetailsReady();
});

// Neuf / Occasion
document.getElementById('btn-neuf').addEventListener('click', () => {
  selectedCondition = 'neuf';
  document.getElementById('btn-neuf').classList.add('selected');
  document.getElementById('btn-occasion').classList.remove('selected');
  checkDetailsReady();
});
document.getElementById('btn-occasion').addEventListener('click', () => {
  selectedCondition = 'occasion';
  document.getElementById('btn-occasion').classList.add('selected');
  document.getElementById('btn-neuf').classList.remove('selected');
  checkDetailsReady();
});

const detailsRequired = ['v-marque', 'v-modele', 'v-couleur', 'v-plaque'];
const btnNextDetails  = document.getElementById('btn-next-details');

function checkDetailsReady() {
  const filled = detailsRequired.every(id => {
    const el = document.getElementById(id);
    return el && el.value.trim().length > 0;
  });
  btnNextDetails.disabled = !filled || !selectedCondition;
}

detailsRequired.forEach(id => {
  document.getElementById(id)?.addEventListener('change', checkDetailsReady);
  document.getElementById(id)?.addEventListener('input',  checkDetailsReady);
});

btnNextDetails.addEventListener('click', () => {
  goTo('screen-permis');
  checkPermisReady();
});

// ══════════════════════════════════════════════════════════════
//  ÉCRAN 3 — Permis de conduire
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-back-details').addEventListener('click', () => goTo('screen-details'));

// Validation du numéro de permis : 5-20 car. alphanumériques + tirets
function validatePermisNumero(val) {
  return /^[A-Z0-9\-]{5,20}$/i.test(val.trim());
}

const numeroInput = document.getElementById('p-numero');
const numeroHint  = document.getElementById('p-numero-hint');

numeroInput.addEventListener('input', () => {
  const val   = numeroInput.value.trim();
  const valid = validatePermisNumero(val);
  numeroHint.textContent = val.length === 0
    ? 'Lettres et chiffres, 5 à 20 caractères'
    : valid
      ? '✓ Format valide'
      : '✗ Lettres, chiffres et tirets uniquement (5–20 car.)';
  numeroHint.className = 'field-hint' + (val.length === 0 ? '' : valid ? ' ok' : ' err');
  numeroInput.classList.toggle('invalid', val.length > 0 && !valid);
  checkPermisReady();
});

const permisRequired = ['p-pays', 'p-nom', 'p-prenom', 'p-date'];
const btnSaveAll     = document.getElementById('btn-save-all');

function checkPermisReady() {
  const filled = permisRequired.every(id => {
    const el = document.getElementById(id);
    return el && el.value.trim().length > 0;
  });
  const numeroOk = validatePermisNumero(document.getElementById('p-numero').value);

  // Vérifier que la date n'est pas dans le futur
  const dateVal = document.getElementById('p-date').value;
  const dateOk  = dateVal && new Date(dateVal) <= new Date();

  btnSaveAll.disabled = !filled || !numeroOk || !dateOk || !permisFile;
}

permisRequired.forEach(id => {
  document.getElementById(id)?.addEventListener('change', checkPermisReady);
  document.getElementById(id)?.addEventListener('input',  checkPermisReady);
});

// ── Avatar picker ──────────────────────────────────────────────
let avatarFile = null;

const avatarPicker  = document.getElementById('avatar-picker');
const avatarInput   = document.getElementById('avatar-file');
const avatarPreview = document.getElementById('avatar-preview');

avatarPicker.addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', () => {
  const file = avatarInput.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showError('permis-error', 'La photo dépasse 2 Mo. Choisissez une image plus légère.');
    return;
  }
  avatarFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    avatarPreview.innerHTML = `<img src="${e.target.result}" alt="avatar" />`;
    avatarPicker.classList.add('has-photo');
    avatarPicker.querySelector('.avatar-label').textContent = 'Photo sélectionnée ✓';
  };
  reader.readAsDataURL(file);
});

async function uploadAvatar(telephone) {
  if (!avatarFile) return null;
  const ext  = avatarFile.name.split('.').pop();
  const path = `drivers/${telephone}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// ── Photo du permis ────────────────────────────────────────────
let permisFile = null;

const permisPicker   = document.getElementById('permis-picker');
const permisInput    = document.getElementById('permis-file');
const permisCamera   = document.getElementById('permis-camera');
const permisPreview  = document.getElementById('permis-preview');
const permisBackdrop = document.getElementById('permis-menu-backdrop');

function applyPermisFile(file) {
  if (!file) return;
  permisBackdrop.classList.remove('open');
  if (file.size > 5 * 1024 * 1024) {
    showError('permis-error', 'La photo du permis dépasse 5 Mo. Choisissez une image plus légère.');
    return;
  }
  permisFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    permisPreview.innerHTML = `<img src="${e.target.result}" alt="permis" />`;
    permisPicker.classList.add('has-photo');
    document.getElementById('permis-picker-label').textContent = 'Photo sélectionnée ✓';
    checkPermisReady();
  };
  reader.readAsDataURL(file);
}

permisPicker.addEventListener('click', () => permisBackdrop.classList.add('open'));
document.getElementById('btn-permis-gallery').addEventListener('click', () => {
  permisBackdrop.classList.remove('open');
  permisInput.click();
});
document.getElementById('btn-permis-camera').addEventListener('click', () => {
  permisBackdrop.classList.remove('open');
  permisCamera.click();
});
document.getElementById('btn-permis-cancel').addEventListener('click', () => {
  permisBackdrop.classList.remove('open');
});
permisBackdrop.addEventListener('click', (e) => {
  if (e.target === permisBackdrop) permisBackdrop.classList.remove('open');
});

permisInput.addEventListener('change',  () => applyPermisFile(permisInput.files[0]));
permisCamera.addEventListener('change', () => applyPermisFile(permisCamera.files[0]));

async function uploadPermisPhoto(telephone) {
  if (!permisFile) return null;
  const ext  = permisFile.name.split('.').pop();
  const path = `drivers/${telephone}_permis.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, permisFile, { upsert: true, contentType: permisFile.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// ── Sauvegarde finale ──────────────────────────────────────────
btnSaveAll.addEventListener('click', async () => {
  const marque  = document.getElementById('v-marque').value;
  const modele  = document.getElementById('v-modele').value;
  const couleur = document.getElementById('v-couleur').value;
  const plaque  = document.getElementById('v-plaque').value.trim().toUpperCase();
  const cyl     = document.getElementById('v-cylindree').value || null;

  const pays    = document.getElementById('p-pays').value;
  const nom     = document.getElementById('p-nom').value.trim().toUpperCase();
  const prenom  = document.getElementById('p-prenom').value.trim();
  const numero  = document.getElementById('p-numero').value.trim().toUpperCase();
  const date    = document.getElementById('p-date').value;

  btnSaveAll.disabled    = true;
  btnSaveAll.textContent = '…';

  try {
    // Upload photos (Storage ouvert aux anon via RLS)
    const newPhotoUrl    = await uploadAvatar(session.telephone);
    const photoUrl       = newPhotoUrl || session.photo || null;
    const permisPhotoUrl = await uploadPermisPhoto(session.telephone);

    // Enregistrement via RPC SECURITY DEFINER (contourne RLS INSERT)
    // Le mot de passe est lu UNE SEULE FOIS puis effacé dans le bloc finally.
    const pendingPw = sessionStorage.getItem('pnr_driver_pending_pw') || '';
    let rpcError = null;
    try {
      const { error } = await supabase.rpc('register_driver', {
        p_telephone       : session.telephone,
        p_prenom          : session.prenom,
        p_nom             : session.nom,
        p_photo           : photoUrl       || '',
        p_type_vehicule   : selectedType,
        p_marque          : marque,
        p_modele          : modele,
        p_couleur         : couleur,
        p_immatriculation : plaque,
        p_etat_vehicule   : selectedCondition,
        p_cylindree       : cyl || '',
        p_permis_pays     : pays,
        p_permis_nom      : nom,
        p_permis_prenom   : prenom,
        p_permis_numero   : numero,
        p_permis_date     : date || '',
        p_permis_photo    : permisPhotoUrl || '',
        p_password        : pendingPw,
      });
      rpcError = error;
    } finally {
      // Toujours effacer le mot de passe, qu'il y ait erreur ou non
      sessionStorage.removeItem('pnr_driver_pending_pw');
    }

    if (rpcError) throw rpcError;
    window.location.replace('driver.html');

  } catch (err) {
    console.error(err);
    showError('permis-error', `Erreur : ${err.message || 'Réessayez.'}`);
    btnSaveAll.disabled    = false;
    btnSaveAll.textContent = 'Terminer l\'inscription ✓';
  }
});
