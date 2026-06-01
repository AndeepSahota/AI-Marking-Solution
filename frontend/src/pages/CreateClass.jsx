import { useState, useEffect, useRef } from 'react'
import {
    createClass, getClasses, getStudents,
    renameClass, addStudentToClass, renameStudent, deleteStudent,
} from '../services/api'
import {
    sanitiseInput, containsHtml, validatePayload,
    CLASS_NAME_MAX, STUDENT_NAME_MAX, MAX_STUDENTS,
} from '../utils/sanitise.js'

/* ─── Icons (reused throughout) ─────────────────────── */

const Icon = {
    pencil: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
    ),
    trash: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    ),
    user: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    ),
    users: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
    plus: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    x: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
    clipboard: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" ry="1" />
        </svg>
    ),
    chevronDown: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
        </svg>
    ),
    info: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
    bulb: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.3 1 2.1V18h6v-1.2c0-.8.3-1.6 1-2.1A7 7 0 0 0 12 2z" />
        </svg>
    ),
    plusCircle: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
    ),
    search: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    check: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
}

/* ─── Create view ───────────────────────────────────── */

function CreateView() {
    const [className, setClassName]     = useState('')
    const [singleInput, setSingleInput] = useState('')
    const [names, setNames]             = useState([])
    const [pasteText, setPasteText]     = useState('')
    const [pasteOpen, setPasteOpen]     = useState(true)
    const [loading, setLoading]         = useState(false)
    const [error, setError]             = useState(null)
    const [success, setSuccess]         = useState(null)

    const updateNamesAndPaste = (nextNames) => {
        setNames(nextNames)
        setPasteText(nextNames.join('\n'))
    }

    const handleSingleKeyDown = (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const sanitised = sanitiseInput(singleInput)
        if (!sanitised) return
        if (containsHtml(sanitised)) {
            setError('Student name must not contain HTML characters.')
            return
        }
        if (sanitised.length > STUDENT_NAME_MAX) {
            setError(`Student name must not exceed ${STUDENT_NAME_MAX} characters.`)
            return
        }
        if (names.length >= MAX_STUDENTS) {
            setError(`Cannot add more than ${MAX_STUDENTS} students.`)
            return
        }
        if (names.includes(sanitised)) {
            setError(`"${sanitised}" is already in the list.`)
            return
        }
        updateNamesAndPaste([...names, sanitised])
        setSingleInput('')
        setError(null)
    }

    const handlePasteChange = (e) => {
        const text = e.target.value
        setPasteText(text)
        const raw = Array.from(new Set(
            text.split('\n').map(l => sanitiseInput(l)).filter(Boolean)
        ))
        const htmlCount    = raw.filter(n => containsHtml(n)).length
        const clean        = raw.filter(n => !containsHtml(n) && n.length <= STUDENT_NAME_MAX)
        const tooLongCount = raw.length - htmlCount - clean.length
        const truncated    = clean.slice(0, MAX_STUDENTS)
        setNames(truncated)
        if (htmlCount > 0) {
            setError(`${htmlCount} name${htmlCount === 1 ? '' : 's'} contained HTML characters and were removed.`)
        } else if (tooLongCount > 0) {
            setError(`${tooLongCount} name${tooLongCount === 1 ? '' : 's'} exceeded ${STUDENT_NAME_MAX} characters and were removed.`)
        } else if (truncated.length < clean.length) {
            setError(`List truncated to the maximum of ${MAX_STUDENTS} students.`)
        } else {
            setError(null)
        }
    }

    const handleRemove = (index) => updateNamesAndPaste(names.filter((_, i) => i !== index))
    const handleClearAll = () => { setNames([]); setPasteText(''); setSingleInput(''); setError(null) }

    const handleSubmit = async () => {
        setError(null)
        setSuccess(null)
        const sanitisedClass = sanitiseInput(className)
        if (!sanitisedClass)                           return setError('Please enter a class name.')
        if (containsHtml(sanitisedClass))              return setError('Class name must not contain HTML characters.')
        if (sanitisedClass.length > CLASS_NAME_MAX)    return setError(`Class name must not exceed ${CLASS_NAME_MAX} characters.`)
        if (names.length === 0)                        return setError('Add at least one student.')
        const payloadErr = validatePayload({ className: sanitisedClass, students: names })
        if (payloadErr) return setError(payloadErr)
        setLoading(true)
        try {
            const result = await createClass(sanitisedClass, names)
            const action = result.is_new ? 'created' : 'updated'
            const added  = result.students_added.length
            setSuccess(`Class "${result.class_name}" ${action}. ${added} student${added === 1 ? '' : 's'} added.`)
            setClassName('')
            handleClearAll()
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const canSubmit = className.trim() && names.length > 0 && !loading

    return (
        <div className="cc-grid">
            <section className="cc-card cc-input-card">
                <div className="cc-field">
                    <label className="cc-field-label">
                        <span className="cc-field-num">1.</span> Class name
                    </label>
                    <input
                        type="text"
                        value={className}
                        onChange={(e) => { setClassName(e.target.value); setError(null) }}
                        placeholder="e.g. Year 10 Set 3 English"
                        className="cc-input"
                        maxLength={CLASS_NAME_MAX}
                        autoFocus
                    />
                    <p className="cc-field-help">Give your class a name you'll recognise.</p>
                </div>

                <div className="cc-field">
                    <label className="cc-field-label">
                        <span className="cc-field-num">2.</span> Add students
                    </label>
                    <input
                        type="text"
                        value={singleInput}
                        onChange={(e) => setSingleInput(e.target.value)}
                        onKeyDown={handleSingleKeyDown}
                        placeholder="Type a student name e.g. Aisha Khan and press Enter"
                        className="cc-input"
                        maxLength={STUDENT_NAME_MAX}
                    />
                    <p className="cc-field-help">Add one student at a time, or paste a full list.</p>

                    <div className={`cc-paste-box${pasteOpen ? ' is-open' : ''}`}>
                        <button
                            type="button"
                            className="cc-paste-header"
                            onClick={() => setPasteOpen(o => !o)}
                            aria-expanded={pasteOpen}
                        >
                            <span className="cc-paste-header-icon">{Icon.clipboard}</span>
                            <span className="cc-paste-header-text">
                                <span className="cc-paste-header-title">Paste multiple names</span>
                                <span className="cc-paste-header-sub">Paste names from a spreadsheet or document.</span>
                            </span>
                            <span className={`cc-paste-chevron${pasteOpen ? ' is-open' : ''}`}>{Icon.chevronDown}</span>
                        </button>
                        {pasteOpen && (
                            <div className="cc-paste-body">
                                <textarea
                                    className="cc-paste-textarea"
                                    value={pasteText}
                                    onChange={handlePasteChange}
                                    placeholder={'Aisha Khan\nMohammed Ali\nSarah Begum'}
                                    rows={6}
                                />
                                <p className="cc-paste-foot">
                                    {Icon.info}
                                    Each name on a new line will be added as a student.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="cc-card cc-students-card">
                <div className="cc-students-header">
                    <h2 className="cc-students-title">
                        Students added <span className="cc-students-count">({names.length})</span>
                    </h2>
                    <button type="button" className="cc-clear-btn" onClick={handleClearAll} disabled={!names.length}>
                        Clear all
                        {Icon.trash}
                    </button>
                </div>

                <div className="cc-students-list">
                    {names.length === 0 ? (
                        <p className="cc-students-empty">No students added yet.</p>
                    ) : names.map((name, i) => (
                        <div key={`${name}-${i}`} className="cc-student-row">
                            <span className="cc-student-avatar">{Icon.user}</span>
                            <span className="cc-student-name">{name}</span>
                            <button
                                type="button"
                                className="cc-student-remove"
                                onClick={() => handleRemove(i)}
                                aria-label={`Remove ${name}`}
                            >
                                {Icon.x}
                            </button>
                        </div>
                    ))}
                </div>

                <div className="cc-tip">
                    <span className="cc-tip-icon">{Icon.bulb}</span>
                    <span><strong>Tip:</strong> You can add or remove students later from your class settings.</span>
                </div>

                {error   && <p className="cc-error">{error}</p>}
                {success && <p className="cc-success">{success}</p>}

                <button type="button" className="cc-create-btn" onClick={handleSubmit} disabled={!canSubmit}>
                    {Icon.plusCircle}
                    <span>{loading ? 'Creating…' : 'Create class'}</span>
                </button>
                <p className="cc-create-help">
                    {canSubmit
                        ? 'Ready to create — your students will be saved with this class.'
                        : 'You must add a class name and at least one student.'}
                </p>
            </section>
        </div>
    )
}

/* ─── Manage view ───────────────────────────────────── */

function ManageView() {
    const [classes, setClasses]               = useState([])
    const [selectedClassId, setSelectedClassId] = useState(null)
    const [students, setStudents]             = useState([])
    const [search, setSearch]                 = useState('')
    const [error, setError]                   = useState(null)

    const [editingClassName, setEditingClassName] = useState(false)
    const [classNameDraft, setClassNameDraft]     = useState('')

    const [editingStudentId, setEditingStudentId] = useState(null)
    const [studentNameDraft, setStudentNameDraft] = useState('')

    const [addingStudent, setAddingStudent]   = useState(false)
    const [newStudentDraft, setNewStudentDraft] = useState('')
    const addInputRef = useRef(null)

    const selectedClass = classes.find(c => c.id === selectedClassId) ?? null

    useEffect(() => {
        getClasses().then(list => {
            setClasses(list)
            if (list.length && !selectedClassId) setSelectedClassId(list[0].id)
        }).catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!selectedClassId) {
            setStudents([])
            return
        }
        getStudents(selectedClassId)
            .then(setStudents)
            .catch(err => setError(err.message))
    }, [selectedClassId])

    useEffect(() => {
        if (addingStudent) addInputRef.current?.focus()
    }, [addingStudent])

    const refreshClassCount = (classId, delta) => {
        setClasses(prev => prev.map(c =>
            c.id === classId ? { ...c, student_count: (c.student_count ?? 0) + delta } : c
        ))
    }

    // Class rename ------------------------------------------------------------

    const startEditClassName = () => {
        if (!selectedClass) return
        setClassNameDraft(selectedClass.class_name)
        setEditingClassName(true)
        setError(null)
    }
    const cancelEditClassName = () => { setEditingClassName(false); setClassNameDraft('') }

    const commitClassName = async () => {
        const sanitised = sanitiseInput(classNameDraft)
        if (!sanitised || sanitised === selectedClass.class_name) {
            cancelEditClassName()
            return
        }
        if (containsHtml(sanitised)) {
            setError('Class name must not contain HTML characters.')
            return
        }
        if (sanitised.length > CLASS_NAME_MAX) {
            setError(`Class name must not exceed ${CLASS_NAME_MAX} characters.`)
            return
        }
        try {
            const updated = await renameClass(selectedClass.id, sanitised)
            setClasses(prev => prev.map(c => c.id === updated.id ? { ...c, class_name: updated.class_name, year_group_id: updated.year_group_id } : c))
            cancelEditClassName()
        } catch (err) {
            setError(err.message)
        }
    }

    // Student rename ----------------------------------------------------------

    const startEditStudent = (s) => {
        setEditingStudentId(s.id)
        setStudentNameDraft(s.student_name)
        setError(null)
    }
    const cancelEditStudent = () => { setEditingStudentId(null); setStudentNameDraft('') }

    const commitStudentName = async () => {
        const sanitised = sanitiseInput(studentNameDraft)
        const target    = students.find(s => s.id === editingStudentId)
        if (!target) return cancelEditStudent()
        if (!sanitised || sanitised === target.student_name) return cancelEditStudent()
        if (containsHtml(sanitised)) {
            setError('Student name must not contain HTML characters.')
            return
        }
        if (sanitised.length > STUDENT_NAME_MAX) {
            setError(`Student name must not exceed ${STUDENT_NAME_MAX} characters.`)
            return
        }
        try {
            const updated = await renameStudent(selectedClass.id, target.id, sanitised)
            setStudents(prev => prev.map(s => s.id === updated.id ? { ...s, student_name: updated.student_name } : s))
            cancelEditStudent()
        } catch (err) {
            setError(err.message)
        }
    }

    // Student delete ----------------------------------------------------------

    const handleDeleteStudent = async (s) => {
        try {
            await deleteStudent(selectedClass.id, s.id)
            setStudents(prev => prev.filter(x => x.id !== s.id))
            refreshClassCount(selectedClass.id, -1)
        } catch (err) {
            setError(err.message)
        }
    }

    // Add student -------------------------------------------------------------

    const handleAddStudentKey = async (e) => {
        if (e.key === 'Escape') {
            setAddingStudent(false)
            setNewStudentDraft('')
            return
        }
        if (e.key !== 'Enter') return
        e.preventDefault()
        const sanitised = sanitiseInput(newStudentDraft)
        if (!sanitised) return
        if (containsHtml(sanitised)) {
            setError('Student name must not contain HTML characters.')
            return
        }
        if (sanitised.length > STUDENT_NAME_MAX) {
            setError(`Student name must not exceed ${STUDENT_NAME_MAX} characters.`)
            return
        }
        try {
            const added = await addStudentToClass(selectedClass.id, sanitised)
            setStudents(prev => [...prev, added].sort((a, b) => a.student_name.localeCompare(b.student_name)))
            refreshClassCount(selectedClass.id, 1)
            setNewStudentDraft('')
        } catch (err) {
            setError(err.message)
        }
    }

    // Filter ------------------------------------------------------------------

    const filteredStudents = search.trim()
        ? students.filter(s => s.student_name.toLowerCase().includes(search.trim().toLowerCase()))
        : students

    /* ─── Render ─────────────────────────────────────────────────────────── */

    return (
        <div className="mc-grid">
            <aside className="cc-card mc-list-card">
                <h2 className="mc-list-title">
                    Your classes <span className="mc-list-count">({classes.length})</span>
                </h2>

                <div className="mc-class-list">
                    {classes.length === 0 ? (
                        <p className="cc-students-empty">No classes yet. Switch to "Create class" to add one.</p>
                    ) : classes.map(cls => (
                        <button
                            key={cls.id}
                            type="button"
                            className={`mc-class-row${cls.id === selectedClassId ? ' is-active' : ''}`}
                            onClick={() => { setSelectedClassId(cls.id); cancelEditClassName(); cancelEditStudent() }}
                        >
                            <span className="mc-class-icon">{Icon.users}</span>
                            <span className="mc-class-text">
                                <span className="mc-class-name">{cls.class_name}</span>
                                <span className="mc-class-sub">
                                    {cls.student_count} student{cls.student_count === 1 ? '' : 's'}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            </aside>

            <section className="cc-card mc-detail-card">
                {!selectedClass ? (
                    <p className="cc-students-empty">Select a class on the left to view its students.</p>
                ) : (
                    <>
                        <div className="mc-detail-header">
                            {editingClassName ? (
                                <input
                                    autoFocus
                                    type="text"
                                    className="cc-input mc-inline-input"
                                    value={classNameDraft}
                                    onChange={(e) => setClassNameDraft(e.target.value)}
                                    onBlur={commitClassName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); commitClassName() }
                                        if (e.key === 'Escape') cancelEditClassName()
                                    }}
                                    maxLength={CLASS_NAME_MAX}
                                />
                            ) : (
                                <h2 className="mc-class-heading">
                                    {selectedClass.class_name}
                                    <button type="button" className="mc-icon-btn" onClick={startEditClassName} aria-label="Rename class">
                                        {Icon.pencil}
                                    </button>
                                </h2>
                            )}
                            <div className="mc-meta-strip">
                                <div className="mc-meta">
                                    <span className="mc-meta-icon">{Icon.users}</span>
                                    <div>
                                        <div className="mc-meta-value">{selectedClass.student_count}</div>
                                        <div className="mc-meta-label">Students</div>
                                    </div>
                                </div>
                                <div className="mc-meta">
                                    <span className="mc-meta-icon">{Icon.user}</span>
                                    <div>
                                        <div className="mc-meta-value">You</div>
                                        <div className="mc-meta-label">Teacher</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mc-students-bar">
                            <h3 className="mc-students-title">
                                Students <span className="cc-students-count">({selectedClass.student_count})</span>
                            </h3>
                            <button
                                type="button"
                                className="mc-add-btn"
                                onClick={() => setAddingStudent(true)}
                            >
                                {Icon.plus}
                                Add student
                            </button>
                        </div>

                        <div className="mc-search">
                            <span className="mc-search-icon">{Icon.search}</span>
                            <input
                                type="text"
                                placeholder="Search students…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="cc-input mc-search-input"
                            />
                        </div>

                        {error && <p className="cc-error">{error}</p>}

                        <div className="mc-student-list">
                            {addingStudent && (
                                <div className="mc-student-row mc-student-adding">
                                    <span className="cc-student-avatar">{Icon.user}</span>
                                    <input
                                        ref={addInputRef}
                                        type="text"
                                        className="mc-inline-input"
                                        placeholder="New student name… (Enter to save, Esc to cancel)"
                                        value={newStudentDraft}
                                        onChange={(e) => setNewStudentDraft(e.target.value)}
                                        onKeyDown={handleAddStudentKey}
                                        onBlur={() => {
                                            if (!newStudentDraft.trim()) {
                                                setAddingStudent(false)
                                                setNewStudentDraft('')
                                            }
                                        }}
                                        maxLength={STUDENT_NAME_MAX}
                                    />
                                    <button
                                        type="button"
                                        className="mc-icon-btn"
                                        onClick={() => { setAddingStudent(false); setNewStudentDraft('') }}
                                        aria-label="Cancel"
                                    >
                                        {Icon.x}
                                    </button>
                                </div>
                            )}

                            {filteredStudents.length === 0 && !addingStudent ? (
                                <p className="cc-students-empty">
                                    {search ? 'No students match your search.' : 'No students in this class yet.'}
                                </p>
                            ) : filteredStudents.map(s => (
                                <div key={s.id} className="mc-student-row">
                                    <span className="cc-student-avatar">{Icon.user}</span>
                                    {editingStudentId === s.id ? (
                                        <input
                                            autoFocus
                                            type="text"
                                            className="mc-inline-input"
                                            value={studentNameDraft}
                                            onChange={(e) => setStudentNameDraft(e.target.value)}
                                            onBlur={commitStudentName}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') { e.preventDefault(); commitStudentName() }
                                                if (e.key === 'Escape') cancelEditStudent()
                                            }}
                                            maxLength={STUDENT_NAME_MAX}
                                        />
                                    ) : (
                                        <span className="cc-student-name">{s.student_name}</span>
                                    )}
                                    <button
                                        type="button"
                                        className="mc-icon-btn"
                                        onClick={() => startEditStudent(s)}
                                        aria-label={`Rename ${s.student_name}`}
                                    >
                                        {Icon.pencil}
                                    </button>
                                    <button
                                        type="button"
                                        className="mc-icon-btn mc-icon-btn-danger"
                                        onClick={() => handleDeleteStudent(s)}
                                        aria-label={`Delete ${s.student_name}`}
                                    >
                                        {Icon.trash}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}

/* ─── Page wrapper ──────────────────────────────────── */

function CreateClass() {
    const [mode, setMode] = useState('create')

    const subtitle = mode === 'create'
        ? <>Create a class by entering the class name, then add your students below.<br />Press Enter after each name, or paste a full class list.</>
        : <>View and manage the classes you've created.</>

    return (
        <div className="cc-page">
            <div className="cc-header">
                <div className="cc-mode-tabs">
                    <button
                        type="button"
                        className={`cc-mode-tab${mode === 'create' ? ' is-active' : ''}`}
                        onClick={() => setMode('create')}
                    >
                        <span className="cc-mode-text">
                            Create <span className="cc-mode-second">class</span>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={`cc-mode-tab${mode === 'manage' ? ' is-active' : ''}`}
                        onClick={() => setMode('manage')}
                    >
                        <span className="cc-mode-text">
                            Manage <span className="cc-mode-second">class</span>
                        </span>
                    </button>
                </div>
                <p className="cc-subtitle">{subtitle}</p>
            </div>

            {mode === 'create' ? <CreateView /> : <ManageView />}
        </div>
    )
}

export default CreateClass
