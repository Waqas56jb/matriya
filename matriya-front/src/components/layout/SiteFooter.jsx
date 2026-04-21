import React from 'react';
import { HiOutlineHeart } from 'react-icons/hi2';
import './SiteFooter.css';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <div className="site-footer__col">
            <h3 className="site-footer__heading">Matriya</h3>
            <p className="site-footer__text">
              Document analysis, structured lab data, and transparent decision workflows — built for research teams.
            </p>
          </div>
          <div className="site-footer__col">
            <h3 className="site-footer__heading">Features</h3>
            <ul className="site-footer__list">
              <li>File upload &amp; indexing</li>
              <li>Evidence-based queries</li>
              <li>Lab research &amp; comparison workflows</li>
            </ul>
          </div>
          <div className="site-footer__col">
            <h3 className="site-footer__heading">Notes</h3>
            <p className="site-footer__text">
              Outputs summarise results defined within the system. For methodological questions contact the project administrator.
            </p>
          </div>
        </div>
        <div className="site-footer__bottom">
          <span className="site-footer__copy">
            © {year} Matriya · All rights reserved
          </span>
          <span className="site-footer__made">
            Built with <HiOutlineHeart className="site-footer__heart" aria-hidden /> research precision
          </span>
        </div>
      </div>
    </footer>
  );
}
