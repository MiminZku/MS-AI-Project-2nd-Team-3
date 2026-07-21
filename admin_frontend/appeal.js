const form = document.getElementById('appealForm');
const formMessage = document.getElementById('formMessage');
const completeCard = document.getElementById('completeCard');
const receiptText = document.getElementById('receiptText');
const newAppealButton = document.getElementById('newAppealButton');

const requiredFields = ['userId', 'caseId', 'email', 'appealReason', 'appealDetail'];

function getFieldValue(id) {
  return document.getElementById(id).value.trim();
}

function validateForm() {
  return requiredFields.every((id) => getFieldValue(id));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!validateForm()) {
    formMessage.classList.remove('success');
    formMessage.textContent = '누락된 항목을 입력해 주세요.';
    return;
  }

  const receiptId = `APL-${Date.now().toString().slice(-6)}`;
  formMessage.classList.add('success');
  formMessage.textContent = '접수가 완료되었습니다.';
  receiptText.textContent = `${getFieldValue('userId')}님의 이의신청이 ${receiptId} 번호로 접수되었습니다.`;
  completeCard.hidden = false;
});

form.addEventListener('reset', () => {
  formMessage.classList.remove('success');
  formMessage.textContent = '';
  completeCard.hidden = true;
});

newAppealButton.addEventListener('click', () => {
  form.reset();
  formMessage.classList.remove('success');
  formMessage.textContent = '';
  completeCard.hidden = true;
  document.getElementById('userId').focus();
});
