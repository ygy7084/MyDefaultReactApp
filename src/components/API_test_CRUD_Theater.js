import React from 'react';

class API_test_CRUD_Theater extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            create_input : '',
            delete_input : ''
        };
        this.createChange = this.createChange.bind(this);
        this.create = this.create.bind(this);
        this.read = this.read.bind(this);
        this.deleteChange = this.deleteChange.bind(this);
        this.delete = this.delete.bind(this);
    }

    createChange(e) {
        this.setState({
            create_input:e.target.value
        });
    }
    create(e) {
        e.preventDefault();
        let data = {
            name : this.state.create_input
        };
        let wrapper = {
            data : data
        };
        return fetch('/api/theater/create', {
            method : 'POST',
            headers : {'Content-Type' : 'application/json'},
            body : JSON.stringify(wrapper)
        })
            .then(res =>{
                if(res.ok)
                    return res.json();
                else
                    return res.json().then(err => { throw err; })})
            .then(res => {
                console.log(res.data);
            })
            .catch((err) => {
                let message = err;
                if(err.message && err.message!=='')
                    message = err.message;
                console.log(message);
            });
    }
    deleteChange(e) {
        this.setState({
            delete_input:e.target.value
        });
    }
    delete(e) {
        e.preventDefault();
        let data = {
            _id : this.state.delete_input
        }
        return fetch('/api/theater/delete', {
            method : 'DELETE',
            headers : {'Content-Type' : 'application/json'},
            body : JSON.stringify(data)
        })
            .then(res =>{
                if(res.ok)
                    return res.json();
                else
                    return res.json().then(err => { throw err; })})
            .then(res => {
                console.log(res.data);
            })
            .catch((err) => {
                let message = err;
                if(err.message && err.message!=='')
                    message = err.message;
                console.log(message);
            });
    }
    read() {
        return fetch('/api/theater/read', {
            method : 'GET'
        })
            .then(res =>{
                if(res.ok)
                    return res.json();
                else
                    return res.json().then(err => { throw err; })})
            .then(res => {
                console.log(res.data);
            })
            .catch((err) => {
                let message = err;
                if(err.message && err.message!=='')
                    message = err.message;
                console.log(message);
            });
    }

    render() {
        return (
            <div>
                <form onSubmit={this.create}>
                    <label>
                        Theater Create
                        <input type='text' value={this.state.create_input} onChange={this.createChange}/>
                    </label>
                    <input type='submit' value='Create'/>
                </form>
                <a href='#' onClick={this.read}>READ ALL</a>
                <form onSubmit={this.delete}>
                    <label>
                        Theater Delete
                        <input type='text' value={this.state.delete_input} onChange={this.deleteChange}/>
                    </label>
                    <input type='submit' value='Delete'/>
                </form>
            </div>
        )
    }
}

export default API_test_CRUD_Theater;