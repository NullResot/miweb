import React from 'react';
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<main>{Array.from({length:1000},(_,index)=><button key={index} id={`item-${index}`}>Item {index}</button>)}</main>);
