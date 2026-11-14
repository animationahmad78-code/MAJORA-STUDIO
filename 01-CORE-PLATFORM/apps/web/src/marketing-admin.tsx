import { useEffect, useState } from 'react';
import { api } from './api';
import { ErrorDialog } from './error-dialog';
import './error-dialog.css';
import './marketing.css';

type Slide = { slot:number; altText:string; targetUrl:string; linkEnabled:boolean; enabled:boolean; imageUrl:string };
type SelectedImage = { file:File; src:string; width:number; height:number };
type ErrorField = 'image'|'alt'|'target'|'timer'|'general';
const frameWidth=1920, frameHeight=1080;

export function AdminMarketingSlides() {
  const [slides,setSlides]=useState<Slide[]>([]);
  const [slot,setSlot]=useState(1); const [alt,setAlt]=useState(''); const [target,setTarget]=useState('');
  const [link,setLink]=useState(false); const [enabled,setEnabled]=useState(true);
  const [image,setImage]=useState<SelectedImage|null>(null); const [zoom,setZoom]=useState(1);
  const [intervalSeconds,setIntervalSeconds]=useState(6); const [busy,setBusy]=useState(false);
  const [error,setError]=useState(''); const [dialog,setDialog]=useState(''); const [errorField,setErrorField]=useState<ErrorField>('general'); const [notice,setNotice]=useState('');
  const fail=(message:string,field:ErrorField)=>{setError(message);setErrorField(field);setDialog(message)};
  const load=()=>api<Slide[]>('/admin/marketing-slides').then(setSlides);
  useEffect(()=>{void Promise.all([load(),api<{intervalSeconds:number}>('/admin/marketing-settings').then(x=>setIntervalSeconds(x.intervalSeconds))]).catch(e=>fail(e instanceof Error?e.message:'دریافت تنظیمات بنر انجام نشد.','general'))},[]);
  useEffect(()=>()=>{if(image)URL.revokeObjectURL(image.src)},[image]);
  const current=slides.find(x=>x.slot===slot);
  const select=(value:number)=>{setSlot(value);const found=slides.find(x=>x.slot===value);setAlt(found?.altText??'');setTarget(found?.targetUrl??'');setLink(found?.linkEnabled??false);setEnabled(found?.enabled??true);setImage(null);setZoom(1);setError('');setNotice('')};
  const chooseImage=async(file?:File)=>{
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){fail('فایل انتخابی عکس نیست. PNG، JPEG یا WebP انتخاب کنید.','image');return}
    try {
      const bitmap=await createImageBitmap(file);
      const width=bitmap.width,height=bitmap.height;bitmap.close();
      if(width<100||height<100){fail('وضوح این تصویر برای بنر کافی نیست. تصویر واضح‌تری انتخاب کنید.','image');return}
      setImage({file,src:URL.createObjectURL(file),width,height});setZoom(1);setError('');setDialog('');setNotice('');
    } catch {fail('تصویر باز نشد. فایل دیگری انتخاب کنید.','image')}
  };
  const contain=image?Math.min(frameWidth/image.width,frameHeight/image.height):1;
  const coverZoom=image?Math.max(frameWidth/(image.width*contain),frameHeight/(image.height*contain)):1;
  const fits=!image||zoom>=coverZoom-.001;
  const imageStyle=image?{width:`${image.width*contain*zoom/frameWidth*100}%`,height:`${image.height*contain*zoom/frameHeight*100}%`}:undefined;
  const encode=async()=>{
    if(!image)return null;
    const bitmap=await createImageBitmap(image.file);
    try {
      const canvas=document.createElement('canvas');canvas.width=frameWidth;canvas.height=frameHeight;
      const context=canvas.getContext('2d');if(!context)throw new Error('پردازش تصویر در این مرورگر ممکن نیست.');
      const width=image.width*contain*zoom,height=image.height*contain*zoom;
      context.drawImage(bitmap,(frameWidth-width)/2,(frameHeight-height)/2,width,height);
      for(let quality=.9;quality>=.5;quality-=.08){const value=canvas.toDataURL('image/jpeg',quality);if(value.length*.75<4_000_000)return value}
      throw new Error('تصویر پس از پردازش هم بزرگ است. تصویر دیگری انتخاب کنید.');
    } finally {bitmap.close()}
  };
  const save=async()=>{
    if(busy)return;
    if(!alt.trim()){fail('برای بنر یک توضیح کوتاه بنویسید تا تصویر برای همه قابل فهم باشد.','alt');return}
    if(link&&!target.trim()){fail('برای بنر قابل کلیک، لینک مقصد را وارد کنید.','target');return}
    if(image&&!fits){fail('تصویر هنوز تمام قاب را پر نکرده است. اندازه را تا ناپدید شدن زمینهٔ ماژورا بیشتر کنید.','image');return}
    if(!image&&!current){fail('برای این جایگاه ابتدا تصویر بنر را انتخاب کنید.','image');return}
    setBusy(true);setError('');setNotice('');
    try{await api(`/admin/marketing-slides/${slot}`,'PUT',{altText:alt,targetUrl:target,linkEnabled:link,enabled,imageDataUrl:await encode()},{silentError:true});await load();setImage(null);setNotice('بنر ذخیره شد و در صفحهٔ خانهٔ فروشگاه‌ها نمایش داده می‌شود.')}
    catch(e){const message=e instanceof Error?e.message:'ذخیره بنر انجام نشد.';fail(message,message.includes('لینک')?'target':message.includes('تصویر')?'image':'general')}
    finally{setBusy(false)}
  };
  const saveTimer=async()=>{
    if(!Number.isInteger(intervalSeconds)||intervalSeconds<3||intervalSeconds>30){fail('زمان تعویض را بین ۳ تا ۳۰ ثانیه وارد کنید.','timer');return}
    setBusy(true);setError('');try{await api('/admin/marketing-settings','PUT',{intervalSeconds},{silentError:true});setNotice(`زمان تعویض خودکار روی ${intervalSeconds.toLocaleString('fa-IR')} ثانیه ذخیره شد.`)}
    catch(e){fail(e instanceof Error?e.message:'زمان تعویض ذخیره نشد.','timer')}finally{setBusy(false)}
  };
  const remove=async()=>{if(!current||!window.confirm('این بنر برای همه فروشگاه‌ها حذف شود؟'))return;setBusy(true);setError('');try{await api(`/admin/marketing-slides/${slot}`,'DELETE',undefined,{silentError:true});await load();setAlt('');setTarget('');setImage(null);setLink(false);setEnabled(true);setNotice('بنر حذف شد.')}catch(e){fail(e instanceof Error?e.message:'حذف بنر انجام نشد.','general')}finally{setBusy(false)}};
  return <div className="marketing-admin" dir="rtl">
    <div className="page-intro"><h2>بنرهای خانه</h2><p>بنر را در قاب واقعی ببینید، اندازه‌اش را تنظیم کنید و نمایش آن را کنترل کنید. روی بنر فروشگاه دکمه‌ای قرار نمی‌گیرد؛ کاربر با کشیدن انگشت آن را عوض می‌کند.</p></div>
    <section className="card marketing-timer"><div><h3>زمان تعویض خودکار</h3><p>برای تمام فروشگاه‌ها یکسان است. در حالت کاهش حرکتِ دستگاه، بنر ثابت می‌ماند.</p></div><label className={errorField==='timer'&&error?'marketing-invalid':''}>ثانیه<input type="number" min={3} max={30} value={intervalSeconds} onChange={e=>setIntervalSeconds(Number(e.target.value))}/>{errorField==='timer'&&error&&<small className="field-error">{error}</small>}</label><button type="button" onClick={saveTimer} disabled={busy}>ذخیرهٔ زمان</button></section>
    <div className="marketing-slots">{[1,2,3,4,5].map(n=><button type="button" className={slot===n?'active':''} key={n} onClick={()=>select(n)}>{`جایگاه ${n.toLocaleString('fa-IR')}`}<small>{slides.find(x=>x.slot===n)?.enabled?'نمایش داده می‌شود':slides.some(x=>x.slot===n)?'خاموش':'خالی'}</small></button>)}</div>
    <section className="card marketing-editor"><h3>ویرایش جایگاه {slot.toLocaleString('fa-IR')}</h3>
      {error&&<p className="field-error" role="alert">{error}</p>}{notice&&<p className="success" role="status">{notice}</p>}
      <div className={`marketing-frame ${errorField==='image'&&error?'marketing-invalid':''}`} role="img" aria-label="پیش‌نمایش قاب بنر با محدوده امن">
        <div className="marketing-frame-watermark"><strong>MAJORA</strong><span>قاب بنر · ۱۶:۹</span></div>
        {image?<img src={image.src} alt="پیش‌نمایش تصویر انتخابی" style={imageStyle} draggable={false}/>:current?<img className="marketing-existing" src={current.imageUrl} alt={current.altText}/>:null}
        <div className="marketing-safe-area" aria-hidden="true"/>
      </div>
      <p className="marketing-frame-help">خط‌چین، محدودهٔ امن متن و لوگوی داخل تصویر است. این راهنما در بنر نهایی دیده نمی‌شود.</p>
      <label className={errorField==='image'&&error?'marketing-invalid':''}>انتخاب تصویر بنر<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void chooseImage(e.target.files?.[0])}/>{errorField==='image'&&error&&<small className="field-error">{error}</small>}</label>
      {image&&<div className="marketing-size-control"><label htmlFor="marketing-zoom">اندازهٔ تصویر در قاب</label><input id="marketing-zoom" type="range" min="0.5" max={Math.max(5,Math.ceil(coverZoom+1))} step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button type="button" onClick={()=>setZoom(coverZoom)}>پر کردن قاب</button><small className={fits?'marketing-fit':'marketing-underfill'}>{fits?'قاب کامل پر شده است.':'زمینهٔ ماژورا پیداست؛ تصویر را بزرگ‌تر کنید.'}</small></div>}
      <label className={errorField==='alt'&&error?'marketing-invalid':''}>توضیح تصویر<input value={alt} onChange={e=>setAlt(e.target.value)} maxLength={160} placeholder="مثلاً معرفی امکانات ماژورا"/>{errorField==='alt'&&error&&<small className="field-error">{error}</small>}</label>
      <label className={errorField==='target'&&error?'marketing-invalid':''}>لینک مقصد اختیاری<input dir="ltr" value={target} onChange={e=>setTarget(e.target.value)} placeholder="https://majoraapp.ir یا /#/why-majora"/>{errorField==='target'&&error&&<small className="field-error">{error}</small>}</label>
      <label className="checkline"><input type="checkbox" checked={link} onChange={e=>setLink(e.target.checked)}/> بنر قابل کلیک باشد</label>
      <label className="checkline"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> در خانه نمایش داده شود</label>
      <div className="form-actions"><button type="button" className="primary" onClick={save} disabled={busy}>{busy?'در حال ذخیره…':'ذخیرهٔ بنر'}</button>{current&&<button type="button" onClick={remove} disabled={busy}>حذف بنر</button>}</div>
    </section><ErrorDialog message={dialog} onClose={()=>setDialog('')}/>
  </div>;
}
