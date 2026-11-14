import { useEffect, useRef } from 'react';

export function ErrorDialog({message,onClose}:{message:string;onClose:()=>void}) {
  const button=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(message)button.current?.focus()},[message]);
  if(!message)return null;
  return <div className="majora-error-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="majora-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="majora-error-title" aria-describedby="majora-error-message" onKeyDown={e=>{if(e.key==='Escape')onClose()}}>
      <span className="majora-error-icon" aria-hidden="true">!</span>
      <h2 id="majora-error-title">این بخش نیاز به اصلاح دارد</h2>
      <p id="majora-error-message">{message}</p>
      <button ref={button} type="button" onClick={onClose}>فهمیدم</button>
    </div>
  </div>;
}
